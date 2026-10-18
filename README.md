# SOMM — Sound of My Mind

**You Are What You Consume** · *A Social Mind for Audiophiles*

| | |
| --- | --- |
| 🌐 **Website** | <https://somm-three.vercel.app> (always on) · backup: <https://soundofmymind.onrender.com> |
| 📱 **Android app** | [Download the latest APK](https://github.com/ebxc-7s13/somm/releases/latest/download/somm-android.apk) · [all releases](https://github.com/ebxc-7s13/somm/releases) |
| 🎵 **Playlist → CSV converter** | <https://somm-three.vercel.app/convert> (no account needed) |

Runs on free plans and is open to the public: **Vercel** serves the site from its CDN and the API as on-demand
functions next to a free Neon PostgreSQL database, so nothing sleeps. The Render deployment from the same repository
is kept as a backup — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#2b-always-up-vercel-recommended-free).

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
npm run seed:demo      # optional, local only: fictional listeners + Trees so matching has something to match
npm run dev            # API on 127.0.0.1:8787, app on http://127.0.0.1:5173
```

Open <http://127.0.0.1:5173>, create an account (a handle and a password — no email), and follow
Import → Map → Mind → Trees → Chat. No configuration is needed for file/CSV imports. The fictional seed data and the
throwaway demo sign-in (`DEMO_MODE_ENABLED=true`) exist for local development only; production never offers them.

Production:

```bash
npm run build && npm start   # serves API + WebSocket + built client from one Node process
```

## Playlist → CSV converter

<https://somm-three.vercel.app/convert> turns a playlist into SOMM's CSV format — one row per song — with no
account. Paste song names, video titles, or Spotify / YouTube / SoundCloud track links (names are read through each
service's official oEmbed endpoint), or upload Spotify's data export (`Playlist1.json`, one CSV per playlist), an
Exportify CSV, an Apple Music/iTunes exported playlist, M3U/M3U8 or XSPF. **Find song details** fills in missing
artist, album, year and genre from MusicBrainz, the open music database. Check every song, download the CSV, then
import that same file. Details: [`docs/MUSIC_IMPORTS.md`](docs/MUSIC_IMPORTS.md#playlist--csv-converter).

**Easiest way to get your playlists out:** use an external playlist tool such as
[TuneMyMusic](https://www.tunemymusic.com/home) — sign in to your music service on their site, export your playlists
to a CSV file, then upload it to Convert or Import. A CSV holding several playlists (with a playlist-name column) is
split into one CSV per playlist. TuneMyMusic is independent of SOMM; its own terms apply.

## Trees: your communities, notifications and shared music

* **Your Trees** lists the Trees you joined, with the latest message and a count of new ones. **Explore similar
  Trees** only suggests Trees you have not joined, ranked by how well your music fits; joined Trees carry a
  *Joined* badge everywhere.
* **Notifications:** a badge on *Trees* in the menu bar, a pop-up with **Open** when a new message arrives, and —
  after you allow it (Settings → *Notifications*) — phone or desktop notifications while SOMM is in the background.
  Tapping one opens that Tree's chat. Opening a chat marks it read; muted and blocked people never count.
* **Share your music:** in a Tree's **Music** tab, share one of your playlists with the Tree (with an optional note).
  Members open its song list there or from the card posted in the chat; you or a moderator can remove it at any time,
  and leaving the Tree withdraws your shares. Sharing never changes the playlist's own privacy setting.

## Music Map: 3D, full screen and posters

* **3D view** (default): drag to rotate and tilt, scroll or pinch to zoom, right-drag / Shift+drag or two fingers to
  pan, twist two fingers to spin; arrow keys, + / − and 0 on the keyboard. **Depth** lifts the rings into a dome,
  **Top / Tilt / Side** jump to a camera angle, **Spin** auto-rotates. 2D and list views remain (the list is the
  screen-reader-friendly alternative).
* **Full screen** for the map stage (in-page full screen where the browser has none, and in the Android app).
* **Text size** slider (60–220 %) for the labels, plus layers for songs, sound attributes and genre connections —
  remembered on the device.
* **Save my map** makes a *Sound of My Mind* poster: portrait 4:5, story 9:16, square or landscape 16:9; flat,
  3D-tilt or your current angle; Midnight, Holo or Daylight; text and map size; 2× “extra sharp”. Under the map: the
  SOMM logo, your **@handle**, your top genres, the date and the site. The whole map and its labels are fitted to the
  frame. Browsers download a PNG (or share it on phones); the Android app opens the share sheet to save it —
  this needs the app version released with this feature (older APKs explain that and point to the download).

## Use it as an app

**Android:** download the latest signed APK — <https://github.com/ebxc-7s13/somm/releases/latest/download/somm-android.apk> — open it on your phone and allow the install when
Android asks. The app opens <https://somm-three.vercel.app> between the status bar and the gesture bar (it never
draws under them), and can show notifications for new Tree messages once you allow them.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ebxc-7s13/somm)

* **Always-up free hosting:** import the repository on Vercel and add `DATABASE_URL` — `vercel.json` and
  `scripts/build-vercel.mjs` do the rest ([steps](docs/DEPLOYMENT.md#2b-always-up-vercel-recommended-free)).
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
| `npm run seed:demo [-- --reset]` | Local development only: seeds 22 **fictional** listeners and the Trees the clustering finds |
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
| Music Map: 3D (rotate/tilt/zoom/pan, depth, camera angles, spin), 2D, list; full screen; text size; layers | ✅ |
| *Sound of My Mind* poster export (4 orientations, 3 themes, @handle + logo under the map) | ✅ browser-verified · 📱 app saving needs the new APK |
| Your Music Mind (evidence-backed insights, confidence, inferred vs verified) | ✅ |
| Transparent matching + Trees (recommend, explain, cluster proposals, create with evidence, join/leave, names) | ✅ |
| Realtime Tree chat (history, replies, song refs, safe links, rate limits, block/mute, reports, moderation) | ✅ |
| Your Trees, unread counts, in-app + phone/desktop notifications, music shared in Trees | ✅ tested · 📱 phone notifications need APK 0.1.9+ |
| Privacy controls, data export, data/account deletion | ✅ |
| MusicBrainz enrichment | ✅ implemented & mock-tested · ⏳ live run needs `MUSICBRAINZ_CONTACT` |
| Spotify / YouTube / Apple Music adapters | ✅ implemented & mock-tested · 🔑 need credentials for live use |
| 1:1 voice/video calls (WebRTC) | 🟡 signalling + authorisation tested; live media between two devices **not verified** |

Details: [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) and [`docs/BUILD_REPORT.md`](docs/BUILD_REPORT.md).

## Project layout

```
src/shared/      Pure TypeScript analysis engine (profile, map layout, insights, similarity, Trees) — no I/O
src/server/      Hono API, PostgreSQL access (node-postgres / PGlite) + migrations, import adapters, enrichment, realtime hub, services
src/client/      React app (custom router, design tokens, pages); map3d/ = 3D map engine, canvas renderer and posters;
                 fx/ = motion layer (live sound-wave background, reveals, tilt cards, cursor effects); styles/fx.scss = glass + holographic styling
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
[Design audit](docs/DESIGN_AUDIT.md) ·
[Deployment](docs/DEPLOYMENT.md) ·
[Cost model](docs/COST_MODEL.md) ·
[Project status](docs/PROJECT_STATUS.md) ·
[Build report](docs/BUILD_REPORT.md)

## Data and licences

The local seed data (listeners, Trees, sample library) and all test fixtures are **fictional**; none of it is on the
public site. Genre/tag data
from MusicBrainz is CC BY-NC-SA 3.0 (core data CC0); see `docs/MUSIC_IMPORTS.md` before any commercial use.
Fonts: Unbounded, Space Grotesk, Sora and Inter (SIL Open Font License), self-hosted.
