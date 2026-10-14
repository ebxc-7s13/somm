# Cost model

Figures below separate **verified** allowances (checked 2026-10-13, with sources) from **assumptions** (estimates
for planning; re-check before budgeting — free tiers change).

## Verified allowances and limits

| Item | Verified fact | Source |
| --- | --- | --- |
| MusicBrainz API | free; ≈1 request/second per IP; contact User-Agent required | musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting |
| iTunes Search API | free; ≈20 calls/minute | performance-partners.apple.com/search-api |
| YouTube Data API v3 | default 10,000 units/day for most endpoints; `playlistItems.list` = 1 unit (≤ 50 items) | developers.google.com/youtube/v3 |
| Spotify Web API | no fee; development mode limited to 5 users, owner needs Premium | Spotify Feb 2026 migration guide |
| Apple Music API | requires paid Apple Developer Program membership | Apple developer documentation (not fetched verbatim) |
| Cloudflare Realtime TURN | first 1,000 GB/month free (shared with SFU), then $0.05/GB | developers.cloudflare.com/realtime/pricing |
| Render free web service | $0; 750 instance hours/month; sleeps after 15 min idle (~1 min to wake); WebSockets supported; no persistent disk | render.com/docs/free |
| Neon free Postgres | $0; suspends when idle; storage and compute-hour caps per project (re-check current numbers) | neon.com/pricing |
| GitHub Actions (private repo, Free plan) | 2,000 Linux minutes/month (CI ≈ 3–4 min per push; an APK build ≈ 5–10 min, estimate) | docs.github.com/billing |

## Assumptions

* Average library: 300 tracks per user; 1.2 playlists per user.
* Catalogue overlap: unique tracks = 60 % of all entries at 100 users, 40 % at 1k, 25 % at 10k.
* Storage: ~1.5 KB per canonical track (row, credits, IDs, genres, attributes, indexes); ~0.4 KB per playlist entry;
  ~150 KB per user for profiles (map JSON, insights, vectors, two scopes); chat ~0.5 KB per message, 50 messages/user/month.
* MusicBrainz: ~2.5 requests per new unique track (search/ISRC + recording + amortised artist lookups).
* Activity: 30 % monthly active; peak concurrent WebSocket connections ≈ 10 % of users; ~200 API requests per active user per month.
* Calls: 5 % of users make one 20-minute call a month; half video (~1.5 Mbps each way), half audio (~50 kbps);
  20 % of calls need TURN relay.
* Hosting: free Render + Neon tiers to start; beyond them one small Linux VM/container or paid tiers. Paid prices are
  **assumptions** (typical market rates), not quotes.

## Estimates

| | 100 users | 1,000 users | 10,000 users |
| --- | --- | --- | --- |
| Playlist entries | 30k | 300k | 3M |
| Unique catalogue tracks | 18k | 120k | 750k |
| Database size (incl. indexes) | ~60 MB | ~0.5 GB | ~4.5 GB |
| API requests / month | ~6k | ~60k | ~600k (≈0.25 req/s average) |
| Peak WebSocket connections | ~10 | ~100 | ~1,000 (≈50 MB RAM) |
| MusicBrainz requests (one-off backlog) | ~45k → ~14 h at 1 req/s | ~300k → ~3.5 days | ~1.9M → ~22 days |
| MusicBrainz ongoing (new tracks) | minutes/day | ~1–2 h/day | many hours/day — **mirror needed** |
| Embedding inference | none (no model) | none | none |
| Call relay traffic (TURN) | < 1 GB | ~5 GB | ~45 GB — within 1,000 GB free tier |
| Compute (assumption) | 1 vCPU / 1 GB | 1 vCPU / 2 GB | 2 vCPU / 4 GB |
| Hosting cost (assumption) | $0 on free tiers (cold starts) | ~$5–20/month (always-on app; database likely beyond free storage) | ~$15–30/month + backups |
| Paid APIs | $0 | $0 | $0 (Apple: Developer Program fee if used) |

## Bottlenecks and mitigations

1. **MusicBrainz rate limit** is the first real constraint (catalogue enrichment, not API traffic). Mitigations already
   in place: one lookup per canonical track for all users, 30-day caching, progressive maps from file metadata. Next:
   self-host a MusicBrainz mirror (open-source server + database dump; needs a VM with ~100 GB disk — assumption) or
   subscribe to the MetaBrainz live data feed; for commercial use also resolve the CC BY-NC-SA genre-tag licence.
2. **Free-tier limits**: Render's free service sleeps (first visit after idle waits ~1 minute) and Neon's free storage
   suits roughly the 100-user column; an always-on instance and a paid database tier are the first upgrades. Postgres
   itself handles this write volume comfortably, and the database is already shared if more instances are added.
3. **Clustering** is O(n²) on discoverable users per batch run — fine for thousands; block by dominant family beyond that.
4. **Group video** is not offered: an SFU would make bandwidth a server cost (Cloudflare’s SFU shares the 1,000 GB free tier).
