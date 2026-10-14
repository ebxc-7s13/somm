# Deployment

SOMM is one Node.js process serving the API, the WebSocket endpoint and the built client, with a SQLite file on
persistent disk. **Nothing has been deployed** from this build — the repository had no hosting configuration and no
cloud credentials were provided.

## Requirements

* Node.js **≥ 22.13** (built-in `node:sqlite`), or Docker.
* A persistent volume for `DATABASE_PATH` (and its `-wal`/`-shm` files).
* HTTPS in front of the app (cookies are `Secure` in production; WebRTC and microphone/camera need a secure context).

## Build and run

```bash
npm ci
npm run build
NODE_ENV=production PORT=8787 HOST=0.0.0.0 \
PUBLIC_URL=https://somm.example.org \
DATABASE_PATH=/var/lib/somm/somm.sqlite \
TOKEN_ENCRYPTION_KEY=<32 random bytes, base64> \
npm start
```

Verified locally (2026-10-13): the production bundle started on port 8899 with a fresh database, served
`/api/health`, the SPA (with CSP headers) and `/api/trees`, and seeded the demo with `SEED_DEMO_ON_START=true`.

### Docker

```bash
docker build -t somm .
docker run -d --name somm -p 8787:8787 -v somm-data:/data \
  -e PUBLIC_URL=https://somm.example.org -e TOKEN_ENCRYPTION_KEY=... somm
```

The Dockerfile was written but **not built** here (Docker is not installed in the development environment).

### Reverse proxy (TLS + WebSocket), Caddy example

```
somm.example.org {
  reverse_proxy 127.0.0.1:8787
}
```
Caddy proxies WebSocket upgrades automatically. With nginx, forward `Upgrade`/`Connection` headers for `/ws`.

### Backups

SQLite in WAL mode: back up with `sqlite3 somm.sqlite ".backup somm-$(date +%F).sqlite"` (online-safe) on a schedule,
or stream to object storage with a tool such as Litestream. Test restores.

## Environment checklist

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PUBLIC_URL` | the HTTPS origin users visit (used for Origin checks and OAuth redirects) |
| `HOST`, `PORT` | `0.0.0.0`, `8787` behind the proxy |
| `DATABASE_PATH` | path on a persistent volume |
| `TOKEN_ENCRYPTION_KEY` | required for provider connections; rotate = all users reconnect |
| `DEMO_MODE_ENABLED` | `true` for public demos, otherwise `false` |
| `SEED_DEMO_ON_START` | `true` only for demo deployments (fictional data) |
| `ADMIN_HANDLES` | comma-separated moderator-of-everything handles |
| `MUSICBRAINZ_CONTACT` | your email or URL — enables enrichment |
| `ITUNES_LOOKUP_ENABLED` | optional |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI` | from the Spotify developer dashboard |
| `YOUTUBE_API_KEY` | Google Cloud API key restricted to the YouTube Data API v3 |
| `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY_PATH` | Apple Developer Program MusicKit key |
| `CALLS_ENABLED`, `STUN_URLS`, `TURN_*` | TURN strongly recommended for real-world calls |

## Provider registration

* **Spotify:** create an app at developer.spotify.com, add the redirect URI exactly
  (`https://<host>/api/providers/spotify/callback`; locally `http://127.0.0.1:8787/api/providers/spotify/callback` —
  loopback IP, not `localhost`), select the Web API. Development mode: owner needs Premium, add up to 5 users by email
  in the dashboard. Public launch beyond that needs extended quota (organisations only).
* **YouTube:** Google Cloud project → enable YouTube Data API v3 → API key with API + HTTP-referrer/IP restrictions.
  Review Developer Policies (30-day retention is implemented; III.E.4.h derived-data clause needs legal review).
* **Apple Music:** Apple Developer Program → Identifiers → Media IDs (MusicKit) → Keys → MusicKit key (.p8). Store the
  key outside the repo. Verify live before enabling for users.
* **MusicBrainz:** no key; set `MUSICBRAINZ_CONTACT`. At scale consider a mirror (see COST_MODEL.md).
* **TURN:** e.g. Cloudflare Realtime TURN (1,000 GB/month free, then $0.05/GB as of 2026-10-13) or self-hosted coturn;
  put static credentials in `TURN_*` (short-lived credential generation is a recommended next step).

## Deployment checklist

- [ ] HTTPS origin and `PUBLIC_URL` set; proxy forwards WebSocket upgrades
- [ ] `TOKEN_ENCRYPTION_KEY` generated and stored in a secret manager
- [ ] Persistent volume + scheduled backups + tested restore
- [ ] `npm run check` green on the release commit
- [ ] `MUSICBRAINZ_CONTACT` set; `npm run smoke:metadata` succeeds from the server
- [ ] Provider credentials added (optional) and each provider tried with a real account
- [ ] `DEMO_MODE_ENABLED` / `SEED_DEMO_ON_START` set deliberately
- [ ] `ADMIN_HANDLES` set; report queue checked regularly
- [ ] TURN configured if calls are enabled; a real two-device call tested
- [ ] Privacy notice published (what is stored, visibility model, deletion/export, MusicBrainz licence attribution)

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank page at `127.0.0.1:5173` in dev | Vite must bind to `127.0.0.1` (configured); check nothing else uses port 5173/8787 |
| `ExperimentalWarning: SQLite` | Expected on Node 22; scripts pass `--disable-warning=ExperimentalWarning` |
| 403 “Cross-origin request rejected” | `PUBLIC_URL` does not match the origin in the browser |
| Spotify `INVALID_CLIENT: Invalid redirect URI` | redirect URI must match the dashboard exactly (use 127.0.0.1 locally) |
| Spotify import 403 | playlist not owned/collaborative — expected under 2026 rules; use Exportify CSV |
| “Genre lookup is off” | set `MUSICBRAINZ_CONTACT`, then “Retry failed lookups” on the import page |
| Calls connect then fail | configure TURN |
