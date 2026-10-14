# Testing

```bash
npm test             # all suites (Vitest 5)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint 10 + typescript-eslint
npm run check        # typecheck + lint + test + build
```

Last full run (2026-10-14, Windows 11, Node 22.23.2): **219 tests in 19 files, all passing**; typecheck and lint clean.

Database tests run real PostgreSQL SQL through **PGlite** (Postgres compiled to WebAssembly, in-process): nothing to
install. `tests/global-setup.ts` migrates one database, dumps it, and caches the snapshot under
`node_modules/.cache/somm` (keyed by PGlite version + migration files); each test worker restores it (~1 s instead of
~8 s for a fresh `initdb`) and truncates all tables before each test server. PGlite costs ~1 ms per query, so the
suite takes ~1.5 minutes; workers are capped at half the logical CPUs because they are CPU-bound.

| File | Tests | Covers |
| --- | --- | --- |
| `tests/unit/normalize.test.ts` | 14 | text folding (incl. Devanagari), version detection (remix/live/acoustic/remaster/edit), featuring, artist splitting, YouTube title parsing, genre aliases/families, tag vocabulary |
| `tests/unit/profile-map.test.ts` | 20 | exact counts, missing genres, co-occurrence, order-independent stable output, verified vs inferred attributes, empty library, map hierarchy + unknown branch, stable layout, single-track and 2,000-track libraries (bounded nodes), regeneration after import, insights (dominant/broad/inferred/verified/caveats/no non-musical claims) |
| `tests/unit/similarity.test.ts` | 17 | identical lists, shared artists without tracks, broad popular-genre overlap, different genres with a few shared artists, unequal sizes + symmetry, missing-feature renormalisation, verified attributes, transparent contributions, one popular song (IDF + evidence), evidence gate, empty libraries, configurable weights, clustering + minimum evidence, labels, aggregation, explanations |
| `tests/integration/imports.test.ts` | 18 | CSV/Exportify/text/M3U/XSPF/JSON parsers, invalid rows, empty/header-only, size and row limits, XXE rejection, attribute vocabulary, preview classification (duplicates, versions, already-in-library), cross-user ISRC/title merge, duration conflicts, include/skip rows, structured errors for invalid/empty/unsupported/unconfigured providers, auth, job progress without enrichment, job isolation |
| `tests/integration/providers.test.ts` | 18 | retry with Retry-After, bounded retries, 401/403/404 mapping, network failure, rate limiter spacing, playlist URL validation (Spotify/YouTube/Apple, Mix/LL rejection, foreign hosts), Spotify PKCE URL, `/items` pagination + `item` field + local/episode skipping + artist genres, owner/collaborator 403, importable flags, rate limiting; YouTube parsing/private videos/30-day retention/404/403; Apple genreNames, library token requirement |
| `tests/integration/enrichment.test.ts` | 7 | MusicBrainz User-Agent, recording pick with length conflicts, genre vote weighting, full enrichment with provenance (genres, credits, tags, years, MBIDs), artist-level fallback, cache reuse across users, not-found, 503 → partial job → retry |
| `tests/integration/api-security.test.ts` | 21 | sign-up/in/out, cookie flags, handle/password validation, demo mode on/off, auth rate limit, CSRF (cross-origin, form posts, chunked text, cross-site), security headers, cross-user isolation (library, tracks, jobs, profile, playlist edits), private playlists excluded from public profile/compare/matching, public-only names in comparison, profile visibility, blocks, reciprocity, library deletion + catalogue pruning, account deletion cascade, export without secrets, encrypted tokens, housekeeping (demo expiry, YouTube 30-day), library search/filter/sort/pagination/long names/coverage, inferred-attribute filter, map regeneration |
| `tests/integration/trees-chat.test.ts` | 19 | creation evidence threshold, eligibility, cluster proposals + candidate-only access + activation at 2 members, ranked/explained recommendations, member self-exclusion, join/leave/archive, k-anonymity, private-playlist protection, empty/low-population Trees, name voting, member directory access + blocks, chat membership, history/timestamps/replies/track refs/safe links, input validation, pagination, rate limit, block/mute filtering, report auto-hide + moderation, report validation |
| `tests/integration/realtime.test.ts` | 8 | real HTTP+WebSocket server: unauthenticated/cross-origin upgrade rejection, member-only delivery, mute filtering, leave stops delivery, reconnect gap-fill, ping/pong, malformed frames; call signalling: full offer/answer/ICE relay, state checks, non-members, blocks, offline callee, decline, ring timeout, disconnect ends call, `CALLS_ENABLED=false` |
| `tests/e2e/workflow.test.ts` | 2 | the 12-step acceptance workflow on the seeded fictional community; seed idempotency; demo listeners cannot sign in |
| `tests/ui/components.test.tsx` | 12 | landing copy/CTAs/taglines, demo network failure, map keyboard access + aria labels + selection + search + dimming, list alternative, offline error + retry, empty states, score ring + breakdown, library long names/coverage/version badges, network failure recovery, empty library |
| `tests/unit/csv.test.ts` | 4 | CSV writer quoting/BOM/CRLF, formula neutralising and restoring, durations, file names, convert → CSV → import round trip (commas, quotes, several artists, formula-like titles, line breaks, attributes, links) |
| `tests/integration/convert.test.ts` | 6 | converter without an account stores nothing (title-only lines kept); Spotify data export split per playlist (episodes skipped, local files read); Apple Music/iTunes export (paths ignored); import still explains bare Spotify links; Spotify links need sign-in, YouTube needs only the server key; validation and rate limit; converted CSV imports the same songs including an edited genre |
| `tests/integration/convert-sources.test.ts` | 12 | song matching: title + artist (original recording chosen over later re-recordings, live/instrumental/video versions and year-only compilations; soundtracks as albums; only empty fields filled, cache), multi-artist credits, artist-genre fallback, unique vs ambiguous titles, busy MusicBrainz, anonymous match API with 5-row limit, 503 when unconfigured, production contact default; forgiving name lists; link classification; Spotify/YouTube/SoundCloud links via oEmbed with playlist-link guidance and removed videos; YouTube playlists without an account |
| `tests/ui/convert.test.tsx` | 4 | paste → convert → flag incomplete row → edit genre → download (file contents checked) → hand-off to import via sign-in; link tab guidance per service; Find song details batches, badges and fill-only-empty; UTF-16 and Windows-1252 file decoding |
| `tests/ui/chat.test.tsx` | 3 | untrusted text not rendered as HTML, safe link attributes, hidden messages, length limit, realtime push, offline send keeps draft |
| `tests/ui/contrast.test.ts` | 21 | WCAG AA (≥ 4.5:1) for 20 token pairs, brand palette values |
| `tests/security/repository.test.ts` | 8 | .gitignore coverage (incl. signing keys), no keystores in the tree, no database URL in `render.yaml`, placeholder-only .env.example, no secret-looking values, no server secrets or `dangerouslySetInnerHTML` in client code, built bundle free of server config, clean UTF-8 |
| `tests/unit/service-worker.test.ts` | 4 | `public/sw.js` in a sandbox: never intercepts `/api`, `/ws`, cross-origin or non-GET requests; network-first pages with an offline page; cache-first hashed assets; only the public shell precached; old caches removed |

## Mocks vs live

* Provider tests use hand-written responses shaped like the documented APIs (`tests/helpers/mockfetch.ts`; unmatched
  URLs throw, so tests never touch the network). **They do not prove that Spotify, YouTube or Apple Music work live** —
  that needs credentials (see DEPLOYMENT.md).
* Live checks performed: iTunes Search lookup through SOMM’s client (`npm run smoke:metadata`, 2026-10-13: “Dance” + store link).
  MusicBrainz live lookups were **not** run because no maintainer contact was configured.

## Manual browser verification (2026-10-13, built-in browser, dev server)

Desktop (≈800 px pane) and mobile emulation (375×812):
landing (hero map, taglines), demo sign-in, onboarding with the fictional sample (preview → shared-for-matching
→ import → job complete), Music Map (layout, selection panel with real tracks, regenerate), Your Music Mind,
Discover Trees (ranked, explained, component sum = score), join, Tree overview, member directory, chat send with
link chip, library on mobile (no horizontal scroll), map on mobile. Issues found this way and fixed: Vite bound to
IPv6 only, centre-label collisions, mouse-focus outline on map nodes, mojibake from a shell edit, instrument column
categories, member self-comparison, identical button names for screen readers.

## Production database check (2026-10-14)

The production bundle ran locally against the Neon database (`DATABASE_URL` from a git-ignored file): migrations
applied, then sign-up → CSV import (12 tracks) → profile → map → library search → facets → Tree recommendations →
account deletion. A read-only count afterwards showed 0 users, tracks, artists, playlists and sessions (only 4 shared
genre-vocabulary rows remain, by design).

## Not covered

* Real WebRTC media between two devices (only signalling is tested).
* Live Spotify/YouTube/Apple/MusicBrainz calls (credentials).
* Automated cross-browser visual tests (no Playwright browsers were downloaded; responsive checks were manual).
* Service-worker registration in a real browser: the desktop app's embedded browser does not support service workers,
  so the worker is verified in the sandbox test above; installing the PWA on a phone is a manual check.
* The Android APK on a device (built only in GitHub Actions, once the app URL and signing secrets are set).
