# Deployment

SOMM is one Node.js process serving the API, the WebSocket endpoint and the built client. Data lives in
**PostgreSQL**. The recommended free setup needs nothing installed on your computer:

| Piece | Free service | Notes |
| --- | --- | --- |
| Database | **Neon** PostgreSQL (free plan) | Serverless Postgres; suspends when idle and resumes on the next query |
| Web app + API + WebSocket | **Render** web service (free plan) | Builds from GitHub; kept awake by the server itself (see below) |
| Installable app | **PWA** (served by the web app) | “Install app” in Chrome/Edge/Android, “Add to Home Screen” on iOS |
| Android app (APK) | **GitHub Actions** | Signed APK built in the cloud; download it from the repository’s Releases |

Status (2026-10-14): the Neon database exists (project `somm`, region AWS Singapore) and the production bundle was
verified against it — migrations applied, then sign-up → CSV import → profile → map → library → Trees → account
deletion all succeeded, and the deletion left no user, track, playlist or session rows. A test run of the APK workflow
(manual run, not published) built and signed a 2.7 MB APK in about 2 minutes; `apksigner` confirmed the release
certificate. The repository owner created the Render service; it is live at <https://soundofmymind.onrender.com>,
and since 2026-10-14 every tested commit on `main` is deployed by CI through the Render deploy hook (first verified
with commit `b541d56`). The Android release `android-6` (0.1.6) opens that address.

## 1. Database (Neon)

1. Create a Neon project in **AWS Asia Pacific (Singapore)** (same region as the Render service) with a database and
   role for SOMM.
2. Copy the **pooled** connection string (`…-pooler…`, `sslmode=require`). It is a secret: keep it in a password
   manager or a git-ignored file such as `.env.neon`; never commit it.

SOMM runs its migrations on start-up (guarded by a Postgres advisory lock), so there is nothing to run by hand.
`npm run db:migrate` with `DATABASE_URL` set does the same explicitly.

## 2. Web app (Render)

The repository contains a Blueprint, [`render.yaml`](../render.yaml): one free web service in Singapore that runs
`npm ci --include=dev && npm run build`, starts with `npm start`, and health-checks `/api/health`.

1. Sign up at render.com with GitHub and allow Render to read this repository.
2. **New → Blueprint**, pick the repository, and apply `render.yaml`.
3. When asked, paste the Neon connection string into `DATABASE_URL`. Leave `MUSICBRAINZ_CONTACT` empty or set an
   email/URL where MusicBrainz can reach you (it enables genre/credit enrichment).
4. Wait for the first deploy, then open `https://soundofmymind.onrender.com/api/health`. The service name in
   `render.yaml` (`soundofmymind`) sets that address, and the Android app is built to open it. If Render reports the
   name as taken, it adds a suffix: then set `SOMM_APP_URL` to the address Render shows and rebuild the APK.

What the Blueprint sets: `NODE_ENV=production`, `HOST=0.0.0.0`, `NODE_VERSION=22`, a generated
`TOKEN_ENCRYPTION_KEY` (256-bit, created once by Render) and `DEMO_MODE_ENABLED=false` — SOMM is public, so there is
no demo sign-in and no fictional data in production (the server refuses demo mode whenever `NODE_ENV=production`,
whatever the variable says). `PUBLIC_URL` defaults to the
service’s own `https://…onrender.com` URL and client IPs are read from `X-Forwarded-For` automatically on Render. Set
`PUBLIC_URL` explicitly if you add a custom domain.

**YouTube playlists (optional, free).** In the Google Cloud console create a project, enable **YouTube Data API v3**,
then **Credentials → Create credentials → API key**; restrict the key to the YouTube Data API v3. In Render → the
service → **Environment**, add `YOUTUBE_API_KEY` with the key and save (Render redeploys). The default quota (10,000
units a day) covers about 500,000 playlist videos a day, since each page of 50 videos costs one unit.

**Deploying new commits.** A service created from the public repository URL (without connecting Render to GitHub)
does not redeploy on push. CI deploys instead, and only after every check passes on `main`:

1. Render → the `soundofmymind` service → **Settings → Deploy Hook** → copy the URL. Treat it as a secret: anyone
   with it can start a deploy.
2. GitHub → repository **Settings → Secrets and variables → Actions → New repository secret**, name
   `RENDER_DEPLOY_HOOK_URL`, paste the URL.

The `Deploy to Render` job in `.github/workflows/ci.yml` then calls the hook and waits until `/api/health` reports the
new commit (Render sets `RENDER_GIT_COMMIT`; the health endpoint returns its first 7 characters as `commit`). Without
the secret the job only leaves a notice. For a one-off update, use **Manual Deploy → Deploy latest commit** on Render.

Render’s free instances have no persistent disk, which is why all data lives in Postgres.

### Always available on free plans

Render spins a free web service down after 15 minutes without inbound traffic, and the next visit then waits about a
minute. To avoid that, the running server requests its own public URL (`/api/health`) every 10 minutes
(`src/server/keepawake.ts`); the request leaves Render and comes back through its edge, so it counts as inbound
traffic. It is on by default on Render (`RENDER_EXTERNAL_URL` is set there); set `KEEP_AWAKE=false` in the service’s
Environment to turn it off, or `KEEP_AWAKE_URL` to ping another https origin.

Limits to keep in mind (checked 2026-10-18):

* Render gives each workspace **750 free instance hours a month**, enough for one service running full-time (a 31-day
  month has 744 hours). If the same workspace runs other free services, the hours can run out, and Render then
  suspends all of the workspace’s free services until the next month — set `KEEP_AWAKE=false` in that case.
* Neon’s free plan includes **100 compute-unit hours a month**, about 400 hours of its smallest compute, so the
  database must not stay awake 24/7. The keep-awake ping never touches the database, the enrichment worker sleeps until
  an import wakes it (it used to check every 5 seconds), and housekeeping runs every 6 hours. Neon therefore still
  pauses about 5 minutes after the last real visit and resumes in under a second on the next query.
* Render may still restart a free service at any time (and does on every deploy); it comes back on its own within about
  a minute, and the Android app shows its retry page meanwhile.

`/api/health` reports `uptimeSeconds`, which shows whether the process has stayed up. Verified 2026-10-18 after the
deploy: with no visitors for 31 minutes, the service answered immediately with `uptimeSeconds` 1922 (no restart), and
Neon suspended its compute 5 minutes after the server's start-up queries while the server kept running.

Why not run SOMM entirely on each phone? The personal half (imports, library, map, posters) could run on a device, but
Trees, chat, calls and listener comparisons need everyone’s data in one shared place, so the app needs a server either
way, and a phone-only version would split each listener’s data from the community. Keeping the one server available is
the simpler and more reliable answer.

Keeping one free instance awake still leaves gaps: later the same day `/api/health` reported a fresh process (126
seconds old) although nothing had been deployed — Render restarted or spun the instance down anyway. For no gaps at
all, run SOMM on Vercel (next section).

## 2b. Always up: Vercel (recommended, free)

Vercel has no single instance that can sleep: the client is served from its CDN, and the API runs as functions that
start on demand in well under a second. SOMM builds for Vercel with the Build Output API
(`npm run build:vercel` → `.vercel/output`, see `scripts/build-vercel.mjs`):

| Piece | On Vercel |
| --- | --- |
| Website and app shell | Static files on Vercel’s CDN, with the same security headers as the API |
| API | One function (`src/vercel/handler.ts`) running the same Hono app, in Singapore (`sin1`) next to the Neon database, up to 5 minutes per request |
| Song lookups (enrichment) | In bursts after the response (`waitUntil`); near the 5-minute limit a burst hands over to a fresh invocation (`/api/internal/enrich`, authenticated with a secret derived on the server); watching an import also restarts a burst |
| Tree chat | New messages every 4 seconds while the chat is open (no WebSocket server) |
| 1:1 calls | Off — they need a long-lived WebSocket connection |
| Large uploads | Sent gzip-compressed (Vercel accepts 4.5 MB per request; a 12 MB Spotify export compresses well below that) |
| Housekeeping | Vercel Cron once a day (`/api/internal/cron`) |
| Database | The same Neon database: the Render and Vercel deployments can run side by side, and a shared lease (`worker_leases`) stops them looking up the same songs twice |

Vercel’s free Hobby plan (checked 2026-10-18) includes 1,000,000 function invocations, 4 hours of active CPU and
360 GB-hours of memory a month, cron jobs once a day, one function region, and is for non-commercial use — SOMM is
far inside those limits.

Set up (about five minutes, in the Vercel dashboard):

1. **Add New → Project → Import** the GitHub repository `ebxc-7s13/somm`. Name the project `soundofmymind` so it gets
   `https://soundofmymind.vercel.app` (if the name is taken, Vercel suggests another).
2. Leave **Framework Preset** on *Other* and the build settings as they are — `vercel.json` sets the build command.
3. Under **Environment Variables** add `DATABASE_URL` with the same value as on Render (Render → the service →
   Environment → `DATABASE_URL`). Optional: `CRON_SECRET` (any long random text; protects the cron endpoint) and
   `TOKEN_ENCRYPTION_KEY` (same as Render; only needed once Spotify or Apple Music sign-in is configured).
4. **Deploy**. Then open `https://<your project>.vercel.app/api/health`: it should show `"host":"vercel"` and
   `"realtime":"poll"`.
5. Point the Android app at it: GitHub → repository **Settings → Secrets and variables → Actions → Variables** → set
   `SOMM_APP_URL` to the Vercel address, then run the **Android APK** workflow. Installed apps that open the Render
   address keep working while Render stays up.

Every push to `main` then deploys to Vercel automatically, alongside the Render deploy hook. CI also builds the Vercel
output and loads the bundled function (`scripts/smoke-vercel.mjs`) on every push.

## 3. Installable web app (PWA)

Nothing to configure. The production build serves `manifest.webmanifest`, PNG icons (`npm run icons` regenerates them
from the logo geometry) and a service worker (`public/sw.js`):

* `/api/*` and `/ws` are never intercepted or cached, so no library, profile or chat data is stored for offline use.
* Pages are network-first (deploys show up immediately) with an offline page when there is no connection.
* Hashed build assets are cache-first; old caches are removed when the worker version changes.

Settings → **Install the app** offers the browser’s install prompt where available, or explains the iOS steps.

## 4. Android app (APK, built in the cloud)

`android/` is a [Capacitor](https://capacitorjs.com) shell that opens the deployed site, so sign-in cookies stay
first-party and web updates reach the app without a new APK. It bundles two local pages (`mobile/www/`): a “can’t
reach SOMM” page with a retry button (shown when the phone is offline or the server is restarting) and a setup notice for builds
without a server URL. The manifest requests microphone/camera for the optional 1:1 calls (Android asks on first use)
and disables cloud backup of app data.

The workflow [`.github/workflows/android.yml`](../.github/workflows/android.yml) needs:

| Setting | Kind | Value |
| --- | --- | --- |
| `SOMM_APP_URL` | repository **variable** | the Render URL, `https://soundofmymind.onrender.com` (https origin, no path) |
| `SOMM_KEYSTORE_BASE64` | repository **secret** | base64 of the PKCS#12 release keystore (alias `somm`) |
| `SOMM_KEYSTORE_PASSWORD` | repository **secret** | the keystore password |

It installs JDK 21 and the Android build tools on GitHub’s runner, syncs the shell, builds `assembleRelease` signed
with the keystore, verifies the signature with `apksigner`, uploads the APK as a workflow artifact and publishes it as
a GitHub Release (`android-<run number>`) whose asset is always named `somm-android.apk`, so
<https://github.com/ebxc-7s13/somm/releases/latest/download/somm-android.apk> always serves the newest build. The version code is the run number, so each APK
installs over the last one.
It runs on demand (**Actions → Android APK → Run workflow**) and on pushes that change the Android shell. A manual
run can override the URL and skip publishing, which is useful for checking the pipeline.

**Keep a copy of the keystore.** GitHub secrets cannot be read back. Android only accepts an update signed with the
same key; with a new key, users must uninstall the old app first. To create a keystore without installing Java
(Git for Windows includes OpenSSL):

```bash
openssl req -x509 -newkey rsa:4096 -sha256 -days 10950 -nodes -subj "/CN=SOMM" -keyout somm.key -out somm.crt
openssl pkcs12 -export -name somm -inkey somm.key -in somm.crt -out somm-release.p12
base64 -w0 somm-release.p12 | gh secret set SOMM_KEYSTORE_BASE64
gh secret set SOMM_KEYSTORE_PASSWORD
```

Installing: open the release on the phone, download the `.apk`, and allow your browser or file manager to install
apps when Android asks. The repository is public, so anyone can download releases without a GitHub account.

Local alternative (needs Android Studio): `npm run mobile:sync`, then open `android/` in Android Studio.

## Other hosts

Any Node 22 host with HTTPS and WebSocket support works:

```bash
npm ci
npm run build
NODE_ENV=production PORT=8787 HOST=0.0.0.0 \
PUBLIC_URL=https://somm.example.org \
DATABASE_URL=postgresql://… \
TOKEN_ENCRYPTION_KEY=<32 random bytes, base64> \
npm start
```

Without `DATABASE_URL`, SOMM uses **PGlite** (embedded Postgres compiled to WebAssembly) in `PGLITE_DATA_DIR` — handy
for a single machine with a persistent disk, not for hosts with ephemeral storage.

### Docker

```bash
docker build -t somm .
docker run -d --name somm -p 8787:8787 \
  -e PUBLIC_URL=https://somm.example.org -e DATABASE_URL=postgresql://… -e TOKEN_ENCRYPTION_KEY=... somm
```

The Dockerfile was written but **not built** here (Docker is not installed in the development environment).

### Reverse proxy (TLS + WebSocket), Caddy example

```
somm.example.org {
  reverse_proxy 127.0.0.1:8787
}
```
Caddy proxies WebSocket upgrades automatically. With nginx, forward `Upgrade`/`Connection` headers for `/ws`. Set
`TRUST_PROXY=true` so rate limits use the client address from `X-Forwarded-For`.

### Backups

Neon keeps a point-in-time restore window on every plan (length depends on the plan). For other Postgres hosts,
schedule `pg_dump` and test restores.

## Environment checklist

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string (secret) |
| `DATABASE_POOL_MAX` | pooled connections, default `5` |
| `PUBLIC_URL` | the HTTPS origin users visit (Origin checks, OAuth redirects); defaults to the Render URL on Render |
| `HOST`, `PORT` | `0.0.0.0`; `PORT` is provided by Render |
| `TRUST_PROXY` | `true` behind a reverse proxy (automatic on Render) |
| `TOKEN_ENCRYPTION_KEY` | required for provider connections; rotate = all users reconnect |
| `DEMO_MODE_ENABLED` | development only: `true` enables the 24-hour throwaway sign-in; always off in production |
| `ADMIN_HANDLES` | comma-separated moderator-of-everything handles |
| `MUSICBRAINZ_CONTACT` | an email or URL MusicBrainz can use to reach you; in production it defaults to the project page |
| `ITUNES_LOOKUP_ENABLED` | optional |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI` | from the Spotify developer dashboard |
| `YOUTUBE_API_KEY` | Google Cloud API key restricted to the YouTube Data API v3 — enables whole-playlist YouTube links (see below) |
| `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY_PATH` | Apple Developer Program MusicKit key |
| `CALLS_ENABLED`, `STUN_URLS`, `TURN_*` | TURN strongly recommended for real-world calls |

## Provider registration

* **Spotify:** create an app at developer.spotify.com, add the redirect URI exactly
  (`https://<host>/api/providers/spotify/callback`; locally `http://127.0.0.1:8787/api/providers/spotify/callback` —
  loopback IP, not `localhost`), select the Web API. Development mode: owner needs Premium, add up to 5 users by email
  in the dashboard. Public launch beyond that needs extended quota (organisations only). The Android app keeps the
  Spotify sign-in inside the app so the redirect returns to it.
* **YouTube:** Google Cloud project → enable YouTube Data API v3 → API key with API + HTTP-referrer/IP restrictions.
  Review Developer Policies (30-day retention is implemented; III.E.4.h derived-data clause needs legal review).
* **Apple Music:** Apple Developer Program → Identifiers → Media IDs (MusicKit) → Keys → MusicKit key (.p8). Store the
  key outside the repo. Verify live before enabling for users.
* **MusicBrainz:** no key; set `MUSICBRAINZ_CONTACT`. At scale consider a mirror (see COST_MODEL.md).
* **TURN:** e.g. Cloudflare Realtime TURN (1,000 GB/month free, then $0.05/GB as of 2026-10-13) or self-hosted coturn;
  put static credentials in `TURN_*` (short-lived credential generation is a recommended next step).

## Deployment checklist

- [ ] Neon database in the same region as the app; `DATABASE_URL` stored only in the host’s secret settings
- [ ] HTTPS origin and `PUBLIC_URL` correct; proxy forwards WebSocket upgrades
- [ ] `TOKEN_ENCRYPTION_KEY` generated and stored as a secret
- [ ] `npm run check` green on the release commit (CI runs it on every push)
- [ ] `MUSICBRAINZ_CONTACT` set; `npm run smoke:metadata` succeeds from the server
- [ ] Provider credentials added (optional) and each provider tried with a real account
- [ ] No fictional data in the production database (`SELECT COUNT(*) FROM users WHERE is_demo <> 0` → 0)
- [ ] `ADMIN_HANDLES` set; report queue checked regularly
- [ ] TURN configured if calls are enabled; a real two-device call tested
- [ ] Android: `SOMM_APP_URL` set, keystore backed up outside GitHub, APK installed and signed in on a real phone
- [ ] Privacy notice published (what is stored, visibility model, deletion/export, MusicBrainz licence attribution)

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank page at `127.0.0.1:5173` in dev | Vite must bind to `127.0.0.1` (configured); check nothing else uses port 5173/8787 |
| First request takes ~1 minute | The service was restarted or deployed (or `KEEP_AWAKE=false`); the Android app shows a retry page meanwhile |
| `password authentication failed` / `ENOTFOUND` on start | `DATABASE_URL` is wrong or was pasted with quotes/spaces |
| 403 “Cross-origin request rejected” | `PUBLIC_URL` does not match the origin in the browser |
| APK workflow skipped on push | `SOMM_APP_URL` variable not set yet; set it, then run the workflow manually |
| APK won’t install over an older one | it was signed with a different keystore; uninstall the old app or restore the original key |
| Spotify `INVALID_CLIENT: Invalid redirect URI` | redirect URI must match the dashboard exactly (use 127.0.0.1 locally) |
| Spotify import 403 | playlist not owned/collaborative — expected under 2026 rules; use Exportify CSV |
| “Genre lookup is off” | set `MUSICBRAINZ_CONTACT`, then “Retry failed lookups” on the import page |
| Calls connect then fail | configure TURN |
