# SOMM — Build report

*Date: 2026-10-13 · Environment: Windows 11, Node.js 22.23.2, npm 10.9.8, git 2.55 · Repository: `D:\personal_projects\my apps\SOMM`*

## 1. Executive summary

SOMM (Sound of My Mind — “You Are What You Consume”) was built from an empty directory into a working,
tested web application. A user can enter through a 24-hour demo mode or a pseudonymous account, import music
(CSV/Exportify, M3U, XSPF, JSON, pasted lists, manual entry; Spotify/YouTube/Apple Music adapters behind
credentials), inspect a deduplicated library with provenance for every metadata value, explore an interactive
**Music Map**, read evidence-backed **Your Music Mind** insights, receive transparent, explained **Tree**
recommendations, join a Tree and **chat in real time**, control visibility, and export or delete their data.

All 12 acceptance criteria are met and covered by an automated end-to-end test plus a manual browser walkthrough.
**186 automated tests pass**; type-check, lint and production build are clean. Provider integrations that need
credentials (Spotify, YouTube, Apple Music) and MusicBrainz enrichment (needs a maintainer contact) are implemented
and mock-tested but were **not run live**. 1:1 voice/video calls have tested signalling but **unverified media**.
Nothing was deployed and nothing was committed.

## 2. What was implemented

* **Foundation:** single-package TypeScript app — Hono API, `ws` realtime, built-in `node:sqlite` with SQL migrations,
  React 19 + Vite client, design tokens (royal blue / deep electric blue / white / yellow / orange / pale blue /
  charcoal; Sora + Inter self-hosted), typographic logo, PWA manifest.
* **Accounts:** handle + scrypt password, HttpOnly session cookies, demo accounts (24 h), settings, export, deletion.
* **Imports:** provider-independent adapter layer; file/text/manual adapters; Spotify (OAuth PKCE, `/playlists/{id}/items`,
  owner/collaborator rules), YouTube (API key, title parsing, 30-day retention), Apple Music (developer token, catalogue +
  library playlists); preview with duplicates/versions/unreadable rows; commit; background enrichment with progress and retry.
* **Catalogue & library:** canonical tracks, namespaced external IDs, identity resolution (provider ID → ISRC →
  title+artist+version with duration/ISRC conflict checks), provenance-tagged genres/attributes, search/filter/sort/pagination,
  song detail, playlist visibility and per-entry hiding.
* **Enrichment:** MusicBrainz client (1.1 s spacing, 503 backoff, contact User-Agent, caching) storing community genres,
  instrument credits, mapped tags and release years; optional iTunes primary-genre fallback.
* **Analysis engine:** deterministic profile statistics, genre taxonomy, inference rules, template insights with confidence,
  deterministic radial Music Map layout, weighted IDF + evidence-gated similarity, aggregation, clustering, labelling, explanations.
* **Trees & social:** recommendations, proposals from clustering, evidence-gated creation, join/leave/archive, k-anonymous
  shared map, related Trees, naming votes, search, reciprocal similar listeners, public profiles, comparison, block/mute/report,
  moderation queue.
* **Chat:** members-only REST + WebSocket chat with gap-fill, replies, track references, safe link chips, rate limits,
  auto-hide after 3 reports, moderator hide/restore, offline-safe sending.
* **Calls:** 1:1 WebRTC with server-authorised signalling, incoming-call UI, permissions handling, mute/camera/end, timeouts.
* **Demo:** 22 fictional listeners → 7 data-labelled Trees; fictional sample library; idempotent seeding.
* **Docs:** README + 12 documents in `docs/`.

## 3. Important architectural decisions

1. **One process, SQLite, no paid services** — zero-config, cheap, reproducible; PostgreSQL is the documented scale-out path.
2. **`node:sqlite`** over better-sqlite3 — no native compilation (experimental in Node 22; wrapper keeps it swappable). *Replaced by PostgreSQL in phase 2 (§16) for free hosting without a persistent disk.*
3. **Pure shared analysis engine** — deterministic, testable, reused by the browser for the landing map.
4. **Server-computed deterministic map layout + custom SVG renderer** with level-of-detail, instead of a force-graph library.
5. **No neural embeddings** — short categorical metadata is handled exactly by statistics; an optional non-overlapping tag
   component exists with weight 0 (MUSIC_ANALYSIS.md).
6. **Two profile scopes** (`all` private / `shared` opt-in) + public on demand, so private playlists drive only the owner’s view.
7. **User-typed metadata on playlist entries**, not on shared tracks.
8. **REST writes + WebSocket push + `?after=` gap-fill** for reliable chat.
9. **Honest provider states** — unconfigured integrations say so in API and UI.

## 4. Important files created

```
package.json, tsconfig.json, vite.config.ts, eslint.config.js, index.html, Dockerfile, .dockerignore, .env.example, .gitignore
.claude/launch.json                      dev-server preview configuration
scripts/dev.mjs, scripts/copy-migrations.mjs
public/favicon.svg, public/manifest.webmanifest
src/shared/   types.ts normalize.ts taxonomy.ts hash.ts demoCatalog.ts
              analysis/{profile,map,insights,similarity,communities}.ts
src/server/   index.ts app.ts config.ts context.ts security.ts http.ts ratelimit.ts catalog.ts
              db/{index.ts,migrate-cli.ts,migrations/001_init.sql}
              import/{types.ts,adapters/{files,spotify,youtube,applemusic,urls}.ts}
              enrich/{musicbrainz,itunes,queue}.ts
              services/{accounts,imports,library,communities,chat,providers}.ts
              realtime/{hub,ws}.ts
              routes/{auth,imports,library,social}.ts
              seed/{demo,demo-cli,trees-cli,smoke-cli}.ts
src/client/   main.tsx App.tsx api.ts router.tsx hooks.ts state.tsx realtime.ts calls.ts types.ts
              styles/{tokens,app}.css
              components/{Logo,Icon,States,Badges,Charts,TreeGlyph,MusicMap,CallOverlay,Shell}.tsx
              pages/{Landing,Auth,Onboarding,Import,ImportJob,Library,TrackDetail,MapPage,Mind,Trees,TreeDetail,TreeChat,Compare,Profile,Settings}.tsx
tests/        setup.ts, helpers/{library,server,mockfetch}.ts, fixtures/*, unit/*, integration/*, e2e/*, ui/*, security/*
docs/         PRODUCT_SPEC ARCHITECTURE DATA_MODEL MUSIC_IMPORTS MUSIC_ANALYSIS MATCHING_ALGORITHM
              PRIVACY_AND_SECURITY TESTING DEPLOYMENT COST_MODEL PROJECT_STATUS BUILD_REPORT (.md)
```

Size: `src/shared` 10 files / 2,639 lines · `src/server` 36 / 6,174 · `src/client` 35 / 7,552 · `tests` 20 / 2,647 · `docs` 12.
No pre-existing files were modified (the repository was empty).

## 5. Database migrations and schema

`src/server/db/migrations/001_init.sql` (applied on start, tracked in `schema_migrations`): `users`, `sessions`,
`provider_connections`, `oauth_states`, `artists`, `albums`, `tracks`, `track_artists`, `external_ids`, `genres`,
`track_genres`, `track_attributes`, `track_tags`, `lookup_cache`, `playlists`, `playlist_tracks`, `import_drafts`,
`import_jobs`, `music_profiles`, `profile_artists`, `profile_tracks`, `profile_genres`, `music_matches`, `communities`,
`community_memberships`, `community_name_proposals`, `community_name_votes`, `community_messages`, `blocks`, `reports`,
`calls` — with foreign keys (cascading deletes from users/playlists/communities), indexes for every lookup path and
check constraints. Privacy classes per table: DATA_MODEL.md.

## 6. Provider integrations and verified capabilities (checked 2026-10-13)

| Provider | Verified capability (source) | SOMM status |
| --- | --- | --- |
| Spotify | `/playlists/{id}/items`; items only for owned/collaborative playlists; `item` replaces `track`; dev mode: owner Premium, 5 users; audio features unavailable to new apps; artist `genres` deprecated; `external_ids` kept (Feb/Mar 2026 changelogs, migration guide, reference pages) | implemented, mock-tested; needs app credentials |
| YouTube Data API v3 | API keys read public data; `playlistItems.list` 1 unit, ≤ 50/page; 10,000 units/day default; stored data refresh/delete within 30 days | implemented, mock-tested; needs API key |
| Apple Music API | developer token (Apple Developer Program, MusicKit key); Music User Token for library (docs not fetchable verbatim) | implemented, mock-tested; needs membership; MusicKit sign-in UI not built |
| iTunes Search | public, ≈20 calls/min, promotional-use terms | live lookup verified (“Digital Love” → Dance + store link) |
| MusicBrainz | ≈1 req/s/IP, contact User-Agent required; core CC0, tags/genres CC BY-NC-SA 3.0 | implemented, mock-tested; live run needs `MUSICBRAINZ_CONTACT` |
| Cloudflare Realtime TURN | 1,000 GB/month free, then $0.05/GB | documented option; not configured |

## 7. Music Map generation and matching methodology

* Map: root → families → genres → artists → tracks, attribute orbit, co-occurrence and multi-genre links; arcs split
  50 % by track weight / 50 % by leaf count; families at 0.55× the artist ring; caps with “+N more”; deterministic.
* Insights: templates over computed statistics; confidence from sample size and coverage; inferred statements labelled.
* Matching: `Σ wᵢ · cosine_IDF(aᵢ,bᵢ) · s/(s+k) / Σ wᵢ` over available components; default weights tracks 0.40 /
  artists 0.25 / genres 0.20 / verified attributes 0.15 / text 0; renormalisation when a component is missing;
  labels with an evidence gate; members compared with other members only.
* Trees: average-linkage clustering (threshold 0.30, min 3), data-derived labels, proposed → active at 2 joins,
  creation requires 2 other compatible discoverable listeners. Details: MUSIC_ANALYSIS.md, MATCHING_ALGORITHM.md.

## 8. Security and privacy measures

scrypt passwords; hashed session tokens in HttpOnly/SameSite cookies; Origin/Sec-Fetch/JSON CSRF defence; strict CSP and
security headers; AES-256-GCM provider tokens; no user-URL fetching (SSRF-safe); XXE-safe XSPF; input/frame limits;
rate limits (auth, messages, reports, previews, search, call invites); per-user authorisation returning 404; members-only
chat; mutual blocks and mutes; reports with auto-hide; private/shared/public playlists, hidden entries, profile
visibility, reciprocal discovery, k-anonymous Tree artists (≥ 3 contributors, ≥ 2 holders); export, library deletion,
account deletion with cascade and catalogue pruning; housekeeping for demo accounts, YouTube data (30 days), drafts and
caches. See PRIVACY_AND_SECURITY.md.

## 9. Commands executed (main ones)

```
git init -b main
npm install hono @hono/node-server ws zod react react-dom @fontsource-variable/sora @fontsource-variable/inter
npm install -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/{react,dom,user-event,jest-dom} \
  @types/{react,react-dom,ws} @types/node@22 tsx esbuild eslint @eslint/js typescript-eslint eslint-plugin-react-hooks globals
npx tsc --noEmit -p tsconfig.json          (repeatedly)
npx eslint .                               (repeatedly)
npx vitest run [...paths]                  (repeatedly)
npm run seed:demo; npx tsx src/server/seed/demo-cli.ts --reset
node scripts/dev.mjs                       (dev servers for browser verification)
npm run build
NODE_ENV=production PORT=8899 SEED_DEMO_ON_START=true node dist/server/index.js   (production smoke test)
npm run smoke:metadata -- "Daft Punk" "Digital Love"                            (live iTunes lookup)
npx vitest run --reporter=json             (per-file counts)
git status --short
```

## 10. Tests — names, counts and results

Final run: **14 files, 186 tests, 186 passed, 0 failed** (Vitest 5.0.4, 25.3 s).

| File | Tests |
| --- | --- |
| tests/unit/normalize.test.ts | 14 |
| tests/unit/profile-map.test.ts | 20 |
| tests/unit/similarity.test.ts | 17 |
| tests/integration/imports.test.ts | 18 |
| tests/integration/providers.test.ts | 18 |
| tests/integration/enrichment.test.ts | 7 |
| tests/integration/api-security.test.ts | 21 |
| tests/integration/trees-chat.test.ts | 19 |
| tests/integration/realtime.test.ts | 8 |
| tests/e2e/workflow.test.ts | 2 |
| tests/ui/components.test.tsx | 12 |
| tests/ui/chat.test.tsx | 3 |
| tests/ui/contrast.test.ts | 21 |
| tests/security/repository.test.ts | 6 |

Test names and what each suite covers are listed in TESTING.md. Failures seen during development and fixed:
a wrong expectation about evidence shrinkage, the enrichment-disabled message, a profile-null expectation,
a **real bug** (bodiless POSTs rejected on a real server — caught only by the WebSocket server tests), missing
Testing Library cleanup, an encoded test path, duplicate `status` roles, a **real logic bug** (members compared with
their own contribution), CSV instrument-column categories, and double-encoded characters from a shell edit.

## 11. Build, lint, type-check and deployment results

* `npx tsc --noEmit` — exit 0, no errors.
* `npx eslint .` — exit 0, no warnings or errors.
* `npm run build` — exit 0: client `dist/client` (main chunk 296 kB / 93.6 kB gzip, pages code-split), server bundle
  `dist/server/index.js` 300.8 kB, migrations copied.
* Production smoke test (port 8899, fresh DB): `/api/health` → `{"ok":true,...}`, `/trees` → 200 with CSP and
  `<title>SOMM — Sound of My Mind</title>`, `/api/trees` → 4.7 kB JSON, demo seeded on start.
* **Deployment: not performed** (no hosting configuration or credentials). Dockerfile written but not built (no Docker).

## 12. Evidence that the core workflow works

* **Automated:** `tests/e2e/workflow.test.ts` walks demo account → sample CSV preview (32 rows, remix detected) →
  commit (29 tracks merged with the catalogue) → job done → library + track detail → map (root 32 tracks, electronic
  family, unknown-genre branch) → insights (top genres, missing-genre caveat) → ≥ 5 ranked Trees with explanations
  whose contributions sum to the score → join → chat history + post + `?after=` → playlist made private (Tree
  contributors drop) → library deleted.
* **Manual (built-in browser, dev server):** the same journey through the UI — onboarding import showed “32 imported ·
  29 matched existing · 84 % genre coverage”; the map rendered families/genres/artists/attributes; Mind stated “strong
  preference for electronic music: 52 %” with evidence; Trees showed “Synthwave Sound Explorers — 48, good match” with
  components 13.0 + 13.0 + 15.5 + 6.1; joining and sending a chat message (with a Spotify link chip) worked; mobile
  (375 px) map and library rendered without horizontal scrolling.

## 13. Features that remain incomplete

* 1:1 calls — real media between two devices not verified; TURN not configured.
* Live provider runs (Spotify, YouTube, Apple Music, MusicBrainz).
* Apple Music MusicKit JS sign-in UI for library playlists.
* Group calls (intentionally not built), admin console, password recovery/2FA, automated browser (Playwright) tests.

## 14. Missing credentials, approvals, costs and infrastructure

* `MUSICBRAINZ_CONTACT` (free) — to enable enrichment.
* Spotify app (free; owner needs Premium; 5 users in dev mode; extended quota limited to organisations).
* YouTube Data API key (free quota) + policy review.
* Apple Developer Program membership (paid) + MusicKit key.
* TURN service (e.g. Cloudflare free tier) for reliable calls.
* Hosting with HTTPS and a persistent volume; backups.
* Legal review: MusicBrainz CC BY-NC-SA for commercial use, YouTube derived-data clause, privacy notice.

## 15. Known limitations and recommended next steps

See PROJECT_STATUS.md. Highest value next: set `MUSICBRAINZ_CONTACT` and validate enrichment on a real library;
register a Spotify dev app; configure TURN and test a two-device call; add a recovery code; validate match weights
with consented engagement data; add Playwright tests; deploy behind HTTPS with backups.

## 16. Phase 2 (2026-10-14): installable app and free hosting

* **Database moved from `node:sqlite` to PostgreSQL** so the app can run on hosts without a persistent disk. The data
  layer is async (`pg` pool against Neon; PGlite for local development and tests), with `AsyncLocalStorage`-scoped
  transactions, `$n` placeholder conversion and advisory-locked migrations. SQL was ported (`ON CONFLICT`, `RETURNING`,
  `GREATEST`, `string_agg`, `jsonb_array_elements_text`, `ILIKE`). The realtime hub queues each connection's frames
  in order and writes call records in order per call. A type-aware lint rule rejects un-awaited promises.
* **Free hosting:** `render.yaml` Blueprint (free web service, Singapore, health check, generated encryption key,
  database URL entered as a secret). The Neon database (`somm`, Singapore) was created and the production bundle was
  verified against it.
* **PWA:** manifest with PNG and maskable icons (rendered by a dependency-free script), a service worker that never
  caches `/api` or `/ws`, an offline page, and an install panel in Settings.
* **Android:** Capacitor 8 shell (`android/`) that opens the hosted site, with offline/retry pages, call permissions,
  backups disabled, and release signing from CI secrets; `.github/workflows/android.yml` builds, verifies and
  publishes a signed APK on GitHub's runners (nothing installed locally).
* Tests: 192 passing (PGlite snapshot setup; new service-worker and repository checks).

## 17. Phase 3 (2026-10-14): playlist converter, public release and continuous deployment

* **Playlist → CSV converter** (`/convert`, no account needed, nothing stored): pasted lists or spreadsheet tables,
  CSV/Exportify, M3U/M3U8, XSPF, JSON, Spotify's account-data export (one CSV per playlist) and Apple Music/iTunes
  playlist exports become SOMM CSV rows in an editable sheet; the CSV can be downloaded, copied or handed to the import
  page as the identical file. A round-trip test proves converted rows import as the same songs.
* **Public repository** after a full-history secret scan; README and the repository's About box link the website, the
  latest APK and the converter.
* **Continuous deployment:** the Render service had been created from the public URL, so pushes did not redeploy. CI
  now calls the Render deploy hook after typecheck, lint, tests and build pass, and waits until `/api/health`
  (which reports `RENDER_GIT_COMMIT`) shows the new commit.
* **Android 0.1.6** released with install instructions, size and SHA-256; download, URL and signature verified.
* Tests: 205 passing in 18 files.

## 18. Git status

* Website: <https://soundofmymind.onrender.com> · Android: <https://github.com/ebxc-7s13/somm/releases/latest>
* Branch: `main` on the GitHub repository <https://github.com/ebxc-7s13/somm>, made **public** on 2026-10-14 after a
  full-history scan found no secrets, keys or personal identifiers (all commits use the GitHub no-reply address).
* History: logical commits — tooling scaffold, analysis engine, server, client, documentation, CI update.
  Author identity uses the GitHub no-reply address (repository-local git config).
* `data/`, `node_modules/`, `dist/` and `.env` are ignored; line endings are normalised to LF (`.gitattributes`).
* CI: GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, tests and build on every push and pull
  request — green on the pushed commits (Ubuntu runner, Node 22).
