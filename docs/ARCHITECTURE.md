# Architecture

## Starting point

The repository was empty (no git history, no framework, no hosting). SOMM was therefore built as a
lightweight, web-first app that can later gain a native client without changing the backend.

## Overview

```
 Browser / installed PWA / Android app (Capacitor shell loading the same site)
   │  HTTPS JSON (cookies, same-origin)        WebSocket /ws (cookie auth)
   ▼                                            ▼
 Node.js 22 single process ───────────────────────────────────────────────
   Hono HTTP app            Realtime hub (ws)         Enrichment worker
   ├─ security middleware   ├─ chat fan-out           ├─ MusicBrainz (1 req/s)
   ├─ routes/*              └─ call signalling        └─ iTunes Search (optional)
   └─ services/* ──────────── shared analysis engine (pure TS, also used by the client)
                     │
               PostgreSQL ── Neon in production (node-postgres pool)
                          └─ PGlite (embedded, WebAssembly) for local dev and tests
```

* **One deployable unit.** API, WebSocket and the built client are served by one Node process; data lives in
  PostgreSQL. No Redis, no queue service, no vector database, no GPU. The free deployment is Render (web service) +
  Neon (Postgres), both in Singapore; see DEPLOYMENT.md.
* **Shared, pure analysis engine** (`src/shared/analysis`). Profile statistics, map layout, insights,
  similarity and clustering are deterministic functions with no I/O. The server uses them to compute and
  store profiles; the landing page uses the same code to draw its fictional demo map in the browser.
* **Provider-independent import layer.** Every source produces a `RawPlaylist` of `RawEntry` objects
  (`src/server/import/types.ts`). Identity resolution, enrichment and analysis never see provider-specific shapes,
  so providers can be added or removed without touching the engine.

## Technology decisions

| Decision | Choice | Why | Alternatives considered |
| --- | --- | --- | --- |
| Runtime | Node.js 22 + TypeScript | One language across client, server and engine | — |
| Database | PostgreSQL: `pg` (node-postgres) against Neon in production; PGlite in-process for development and tests | Free hosted Postgres survives Render’s ephemeral disk; PGlite is real Postgres with nothing to install, so tests run the production SQL | SQLite via `node:sqlite` (the original choice — needs a persistent disk, which free hosts lack), Supabase (also Postgres; more services than needed) |
| HTTP | Hono + `@hono/node-server` | Small, typed, fast, works with `app.request()` for in-memory tests | Express, Fastify |
| Realtime | `ws` on the same server | Simple, no external broker; REST writes + WS push + `?after=` gap-fill | Supabase Realtime, SSE |
| Installable app | PWA (manifest + service worker) and a Capacitor Android shell built by GitHub Actions | One codebase; the APK opens the hosted site, so cookies stay first-party and updates need no new APK | Bundling the client in the APK (needs cross-site cookies/CORS), React Native (second UI codebase) |
| Validation | zod | Schema validation for every request body | — |
| Client | React 19 + Vite | Mature, fast build; code-split pages | — |
| Routing | ~60-line custom History router | Avoids a dependency for a dozen routes | react-router |
| Styling | Plain CSS with design tokens (`tokens.css`) | Distinctive identity, no utility-class sprawl, contrast tested from tokens | Tailwind |
| Graph rendering | Custom SVG renderer + server-computed radial layout | Deterministic, testable, stable across devices, tiny bundle; LOD keeps it fast on phones | Cytoscape.js (~400 KB), force layouts (non-deterministic) |
| Fonts | Sora (display) + Inter (text), self-hosted via @fontsource | OFL licence; no third-party font requests (privacy) | Google Fonts CDN |
| ML | None | Deterministic statistics answer the product questions exactly; see MUSIC_ANALYSIS.md | Sentence-Transformers/ONNX (≈100 MB+ runtime) |

The DB layer (`src/server/db/index.ts`) exposes only async `all/get/run/tx` over either driver. Services write
`?` (or `:name`) placeholders, converted to `$n`. `tx()` runs a callback in a transaction and routes every query made
inside it — however deeply nested — to the transaction's connection via `AsyncLocalStorage`, so services never pass
connection handles around; nested `tx()` calls join the outer transaction. `bigint`/`numeric` columns are parsed as
JavaScript numbers. Migrations run on start-up inside a transaction holding a Postgres advisory lock, so two
instances starting together cannot apply one twice. ESLint's type-aware `no-floating-promises` rule guards the
server and tests against un-awaited queries.

## Server modules

| Path | Responsibility |
| --- | --- |
| `config.ts` | Environment parsing (zod), allowed origins, ICE servers, match weights |
| `db/` | PostgreSQL access (node-postgres pool or PGlite), placeholder conversion, transactions, migrations (`migrations/*.sql`) |
| `security.ts` | scrypt password hashing, session tokens, PKCE, AES-256-GCM token vault |
| `http.ts` | Outbound JSON fetch with timeouts, bounded retries, Retry-After, typed `ProviderError`; `RateLimiter` |
| `import/adapters/` | `files.ts` (CSV, text, M3U, XSPF, JSON, manual), `spotify.ts`, `youtube.ts`, `applemusic.ts`, `urls.ts` |
| `catalog.ts` | Canonical artists/albums/tracks, external IDs, provenance-tagged genres/attributes, identity resolution, preview classification |
| `enrich/` | MusicBrainz + iTunes clients, background `EnrichmentQueue` with caching |
| `services/` | accounts, imports, library/profiles, communities (Trees), chat, providers |
| `realtime/` | `hub.ts` (chat fan-out, call signalling), `ws.ts` (authenticated upgrade, heartbeats) |
| `routes/` | auth/account, imports/providers, library/profile, social (Trees, chat, people, safety, calls) |
| `seed/` | Fictional demo seeding, Tree clustering CLI, metadata smoke test |

## Request pipeline

1. Security headers on every response (CSP, nosniff, frame-deny, COOP, Permissions-Policy, HSTS in production).
2. `/api/*` mutating requests: Origin must be allow-listed, `Sec-Fetch-Site` must not be cross-site, bodies must be JSON, size ≤ 3.5 MB.
3. Session cookie → user (SHA-256 token lookup; expired sessions/demo accounts rejected).
4. Route handler validates input (zod), checks ownership/membership, calls a service.
5. Errors map to `{ error: { code, message } }` with the right status; unknown errors are logged without request data.

## Data flow: import to Tree

1. **Preview** parses the source into a `RawPlaylist`, classifies entries (duplicates, versions,
   already-owned, low-confidence) and stores a 1-hour draft.
2. **Commit** resolves each entry to a canonical track (provider ID → ISRC → title/artist/version with
   conflict checks), writes the playlist and entries, creates an import job, and computes a first profile
   immediately from available metadata.
3. **Enrichment** runs in the background: each canonical track is looked up once (MusicBrainz), results are
   cached with expiry, and affected users’ profiles are recomputed in debounced batches.
4. **Profiles** are computed for two scopes — `all` (owner only) and `shared` (shared/public playlists) —
   and the shared scope feeds inverted indexes (`profile_tracks/artists/genres`) for IDF and candidate generation.
5. **Trees** aggregate members’ shared vectors; recommendations compare a user’s `all` vector with each
   Tree (excluding the user’s own contribution when already a member).

## Realtime and calls

Chat messages are created through REST (validation, rate limits, persistence), then pushed by the hub to
subscribed members, filtered per recipient for blocks/mutes. Clients reconnect with exponential backoff
and fetch `?after=<lastId>` on reconnect, so no message is lost when a socket drops.

Calls use the same socket for signalling. The hub authorises each invite (shared Tree, no block, callee online,
not busy, not a fictional demo listener), relays SDP/ICE only between the two participants, times out
ringing after 45 s, records call metadata (never media) and ends calls when a participant disconnects.

## Scaling path

* **10k users on one node** is comfortable for one Postgres database (see COST_MODEL.md). The first bottleneck is
  MusicBrainz’s 1 request/second limit for *new* catalogue tracks — mitigated by global caching, and at
  scale by hosting a MusicBrainz mirror (open source) or the MetaBrainz live data feed.
* **Multiple instances** would need: a shared rate-limit store, pub/sub for WebSocket fan-out (e.g. Postgres
  LISTEN/NOTIFY or Redis), and moving the enrichment worker to one leader. The database is already shared.
* **Android** runs today as a Capacitor shell around the hosted site; a fully native client could reuse the API and
  WebSocket protocol unchanged.
