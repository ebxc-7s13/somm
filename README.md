# SOMM — Sound of My Mind

**You Are What You Consume** · *A Social Mind for Audiophiles*

SOMM turns a playlist into an interactive **Music Map** of your musical identity, explains what
your library says about your taste — with the evidence and the source behind every statement —
and connects you with listeners whose maps genuinely overlap yours in music-based communities
called **Trees**, each with its own shared map and chat.

It is a music-intelligence and community app, not a player or a generic social network: SOMM never
streams or stores audio, never asks for your Spotify/YouTube/Apple password, and never builds
psychological or demographic profiles.

## Quick start

Requires **Node.js ≥ 22.13**. No database server, Docker or paid service is needed locally: without
`DATABASE_URL`, SOMM uses PGlite, an embedded PostgreSQL compiled to WebAssembly, stored in `./data/pglite`.

```bash
npm install
npm run seed:demo      # optional: fictional demo listeners + Trees so matching has something to match
npm run dev            # API on 127.0.0.1:8787, app on http://127.0.0.1:5173
```

Open <http://127.0.0.1:5173>, click **Try the demo**, choose **Fictional sample**, and follow
Import → Map → Mind → Trees → Chat. No configuration is needed for file/CSV imports.

Production:

```bash
npm run build && npm start   # serves API + WebSocket + built client from one Node process
```

## Use it as an app

**Android:** download the latest signed APK — <https://github.com/ebxc-7s13/somm/releases/latest/download/somm-android.apk> — open it on your phone and allow the install when
Android asks. The app opens <https://soundofmymind.onrender.com>; on the free plan the server sleeps when idle, so the
first visit can take about a minute while it wakes.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ebxc-7s13/somm)

* **Free hosting:** a Render Blueprint ([`render.yaml`](render.yaml)) runs the web app on Render’s free plan with a
  free Neon PostgreSQL database. Step by step: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
* **Install from the browser:** SOMM is a Progressive Web App — use “Install app” (Chrome, Edge, Android) or
  “Add to Home Screen” (iOS Safari). Settings → *Install the app* offers the prompt when the browser allows it.
* **Android APK:** a GitHub Actions workflow builds a signed APK of the Capacitor shell in `android/` — no Android
  Studio needed — and publishes it as a GitHub Release.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API server (tsx watch) + Vite dev server |
| `npm run build` | Builds the client (`dist/client`) and bundles the server (`dist/server`) with migrations |
| `npm start` | Runs the production build |
| `npm test` | Runs all automated tests (Vitest: unit, integration, realtime, UI, security, end-to-end) |
| `npm run check` | Typecheck, lint, tests and build — what CI runs |
| `npm run db:migrate` | Applies database migrations (also done automatically on start) |
| `npm run icons` | Regenerates the PNG app icons and Android launcher/splash images from the logo geometry |
| `npm run mobile:sync` | Copies the mobile shell into `android/` (for local Android Studio builds) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run check` | typecheck + lint + test + build |
| `npm run seed:demo [-- --reset]` | Seeds 22 **fictional** demo listeners and the Trees the clustering finds |
| `npm run trees:generate` | Runs Tree-proposal clustering over discoverable listeners |
| `npm run smoke:metadata -- "Artist" "Title"` | One live iTunes lookup, plus MusicBrainz if `MUSICBRAINZ_CONTACT` is set |
| `npm run db:migrate` | Applies SQL migrations |

## Configuration

Copy `.env.example` to `.env`. Everything is optional for local use. Key settings:

* `MUSICBRAINZ_CONTACT` — turns on genre/credit enrichment (MusicBrainz requires a contact in the User-Agent).
* `TOKEN_ENCRYPTION_KEY` — 32-byte base64 key for encrypting OAuth tokens (required in production).
* `SPOTIFY_CLIENT_ID` / `SPOTIFY_REDIRECT_URI`, `YOUTUBE_API_KEY`, `APPLE_MUSIC_*` — provider imports.
* `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` — optional relay for calls on restrictive networks.

Provider availability is shown honestly in the app (Settings → Music sources): an integration
without credentials says *“Not configured on this server”* instead of pretending to work.

## What works today

| Area | Status |
| --- | --- |
| CSV / Exportify / M3U / XSPF / JSON / pasted list / manual import | ✅ working, tested |
| Dedupe & versions (provider ID → ISRC → title+artist+version with duration/ISRC conflict checks) | ✅ |
| Song library (search, filters, sorting, pagination, coverage, provenance, song detail) | ✅ |
| Music Map (radial layout, LOD, zoom/pan/pinch/keyboard, search, list alternative) | ✅ |
| Your Music Mind (evidence-backed insights, confidence, inferred vs verified) | ✅ |
| Transparent matching + Trees (recommend, explain, cluster proposals, create with evidence, join/leave, names) | ✅ |
| Realtime Tree chat (history, replies, song refs, safe links, rate limits, block/mute, reports, moderation) | ✅ |
| Privacy controls, data export, data/account deletion | ✅ |
| MusicBrainz enrichment | ✅ implemented & mock-tested · ⏳ live run needs `MUSICBRAINZ_CONTACT` |
| Spotify / YouTube / Apple Music adapters | ✅ implemented & mock-tested · 🔑 need credentials for live use |
| 1:1 voice/video calls (WebRTC) | 🟡 signalling + authorisation tested; live media between two devices **not verified** |

Details: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) and [`docs/BUILD_REPORT.md`](docs/BUILD_REPORT.md).

## Project layout

```
src/shared/      Pure TypeScript analysis engine (profile, map layout, insights, similarity, Trees) — no I/O
src/server/      Hono API, PostgreSQL access (node-postgres / PGlite) + migrations, import adapters, enrichment, realtime hub, services
src/client/      React app (custom router, design tokens, Music Map renderer, pages)
tests/           unit · integration · realtime · ui (jsdom) · security · e2e acceptance workflow
android/         Capacitor Android shell (opens the hosted app); mobile/www/ holds its offline pages
public/          Static files: manifest, icons, service worker (sw.js)
docs/            Product, architecture, data model, imports, analysis, matching, privacy, testing, deployment, cost, status, build report
```

## Documentation

[Product spec](docs/PRODUCT_SPEC.md) ·
[Architecture](docs/ARCHITECTURE.md) ·
[Data model](docs/DATA_MODEL.md) ·
[Music imports & providers](docs/MUSIC_IMPORTS.md) ·
[Music analysis](docs/MUSIC_ANALYSIS.md) ·
[Matching algorithm](docs/MATCHING_ALGORITHM.md) ·
[Privacy & security](docs/PRIVACY_AND_SECURITY.md) ·
[Testing](docs/TESTING.md) ·
[Deployment](docs/DEPLOYMENT.md) ·
[Cost model](docs/COST_MODEL.md) ·
[Project status](docs/PROJECT_STATUS.md) ·
[Build report](docs/BUILD_REPORT.md)

## Data and licences

Demo listeners, demo Trees, the sample library and all test fixtures are **fictional**. Genre/tag data
from MusicBrainz is CC BY-NC-SA 3.0 (core data CC0); see `docs/MUSIC_IMPORTS.md` before any commercial use.
Fonts: Sora and Inter (SIL Open Font License), self-hosted.
