# SOMM — Product specification

*SOMM — Sound of My Mind · “You Are What You Consume” · “A Social Mind for Audiophiles”*

## Vision

A person’s music collection is a combination of genres, artists, instruments, rhythms, moods and
production styles. SOMM imports a playlist, identifies its songs, collects the metadata that can be
obtained legitimately, and turns it into an interactive **Music Map**. People whose maps overlap
sufficiently are grouped into **Trees** — music-based communities with a shared map and chat.

SOMM is **not** a music player, a Spotify clone, a recommendation chatbot or a general social network.

## Non-negotiable principles (and how they are enforced)

| Principle | Enforcement |
| --- | --- |
| Music metadata is the only input | No demographic fields exist in the schema; insights are template-generated from music statistics only (`src/shared/analysis/insights.ts`, test “never makes non-musical claims”). |
| Minimal personal data | Accounts are a pseudonymous handle + password; no email, birth date, contacts or location. |
| Authorised sources only | Official APIs via OAuth/API keys; no scraping; user-supplied URLs are parsed for IDs on allow-listed hosts and never fetched. |
| Never ask for provider passwords | Spotify uses OAuth PKCE; Apple uses MusicKit; YouTube uses an API key for public playlists. |
| Works with partial metadata | Unknown genres appear on an explicit “Genre unknown” branch; insights carry coverage caveats. |
| Distinguish fact, inference, uncertainty | Every genre/attribute has a `kind` (provided, credited, community, user, inferred) and confidence; inferred values are drawn dashed/orange and never used for matching. |
| Low cost | One Node process + SQLite; no GPU, no hosted LLM, no paid service required. |
| No invented functionality | Unconfigured providers show “Not configured on this server”; calls are marked partially verified. |

## Users and core journey

**Import → process → Music Map → Music Mind → matching Trees → join → chat.** No questionnaire.
A demo mode (24-hour temporary account + fictional sample library + fictional community) lets anyone
walk the whole journey without credentials.

## Features

### A. Music import
Sources: CSV (incl. Exportify exports of Spotify playlists), M3U/M3U8, XSPF, SOMM JSON, pasted lists,
manual entry with MusicBrainz song search, Spotify (OAuth), YouTube (public/unlisted playlists),
Apple Music (catalogue playlists; library playlists via MusicKit). Workflow: choose source →
connect (if needed) → preview every detected track with duplicate / alternate-version / already-in-library /
low-confidence flags and unreadable rows → choose rows, name and sharing → import → progress → library.
See [MUSIC_IMPORTS.md](MUSIC_IMPORTS.md).

### B. Song library
Search (title, artist incl. featured, album, genre), filters (genre, family, artist, source, playlist,
attribute, unknown genre), sorting (added, title, artist, year, source), pagination, per-track metadata
coverage dots, song detail with provenance of every genre/attribute, provider links with attribution,
“as imported” raw data, match method, enrichment status, per-entry hide-from-sharing.

### C. Music Map
Radial hierarchy *My Music Mind → genre families → genres → artists → tracks*, an outer orbit of sound
attributes, co-occurrence chords and artist-spans-genres links. Node size = track count; branch width =
relationship strength; colour = family; dashed outlines = uncertain/inferred. Zoom, pan, pinch, keyboard,
search highlight, click-to-inspect with real track lists, level-of-detail for large libraries, list view
alternative, regenerate, and comparison with another listener. See [MUSIC_ANALYSIS.md](MUSIC_ANALYSIS.md).

### D. Your Music Mind
Evidence-backed observations with confidence and basis (metadata / inferred / about the data),
distributions (families, genres, artists, decades), diversity metrics, attribute table (verified vs
inferred), genre combinations, explicit uncertainty statements and a “musical taste, not personality” note.

### E. Lightweight music intelligence
Stage 1 deterministic statistics; Stage 2 optional tag-token similarity (TF-IDF, weight 0 by default);
Stage 3 weighted, IDF-adjusted, evidence-gated vector similarity; Stage 4 template summaries.
No neural model is used; the decision and its evaluation are in [MUSIC_ANALYSIS.md](MUSIC_ANALYSIS.md).

### F. Trees and social discovery
Recommendations with transparent component scores and plain-language reasons; proposed Trees from
average-linkage clustering (min 3 listeners, similarity ≥ 0.3) labelled from the data; member-created
Trees only when ≥ 2 other compatible discoverable listeners exist; join/leave; k-anonymous shared map;
related Trees; name proposals with majority voting; search across Trees, public listeners and your
library; reciprocal similar-listener discovery; public profiles with visibility controls; profile
comparison; block, mute and report. See [MATCHING_ALGORITHM.md](MATCHING_ALGORITHM.md).

### G. Tree chat
Members-only realtime chat with history pagination, gap-fill after reconnect, replies, track references
(from your own library), safe provider link chips, rate limits, block/mute filtering, reports with
auto-hide at 3 reports, moderator hide/restore, connection status and offline-safe sending.

### Optional: voice and video calls
1:1 WebRTC calls between members of a shared Tree, with permission prompts, incoming-call screen,
accept/decline/mute/camera/end, timeouts and honest failure states. Signalling and authorisation are
implemented and tested; peer-to-peer media between two real devices was **not** verified (see status).

## Pages

| # | Page | Route |
| --- | --- | --- |
| 1 | Landing | `/` |
| 2 | Sign in / Sign up | `/signin`, `/signup` |
| 3 | First-time onboarding | `/welcome` |
| 4 | Connect / import music | `/import` |
| 5 | Import progress & errors | `/import/jobs/:id` |
| 6 | Music library | `/library` |
| 7 | Song detail | `/library/tracks/:id` |
| 8 | My Music Map | `/map` |
| 9 | Your Music Mind | `/mind` |
| 10 | Discover Trees | `/trees` |
| 11 | Tree detail | `/trees/:slug` |
| 12 | Tree member directory | `/trees/:slug/members` |
| 13 | Tree chat | `/trees/:slug/chat` |
| 14 | Profile comparison | `/compare/:handle` |
| 15 | Privacy & sharing | `/settings/privacy` |
| 16 | Settings & connected providers | `/settings` |
| 17 | Account & data deletion | `/settings/account` |
| + | Public profile | `/u/:handle` |

## Acceptance criteria → evidence

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Account or explicit demo mode | `POST /api/auth/demo`; tests `api-security` “demo mode”; browser walkthrough |
| 2 | Import a playlist/CSV | `tests/e2e/workflow.test.ts`, `imports.test.ts`; browser import of the sample CSV |
| 3 | Resolve & deduplicate | `catalog.ts`; tests for duplicates, versions, duration conflicts, ISRC, cross-user merge |
| 4 | Inspect metadata | Library + song detail; e2e test asserts track detail |
| 5 | Music Map from computed data | `buildMusicMap`; unit + e2e tests; browser screenshots |
| 6 | Evidence-backed insights | `generateInsights`; unit tests; Mind page |
| 7 | Compare with community profiles | `recommendTrees`; e2e asserts ≥ 5 ranked Trees |
| 8 | Explain scores | `explainMatch` + `MatchBreakdown`; e2e asserts contributions sum to score |
| 9 | Join a Tree | e2e + integration tests; browser |
| 10 | Text chat | REST + WebSocket tests on a real server; browser send |
| 11 | Visibility control & data removal | privacy/isolation/deletion tests; e2e |
| 12 | Tests pass; build reproduces | 186/186 tests; `npm run build` + production smoke test (see BUILD_REPORT) |
