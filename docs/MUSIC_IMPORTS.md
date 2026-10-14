# Music imports and providers

Provider capabilities were checked against official documentation on **2026-10-13**. Where a page could
not be read directly this is stated. Integrations are tested with deterministic mocks shaped like the
documented responses; a passing mock test proves SOMM’s handling, **not** that a live provider works.

## Capability matrix

| Source | Status in this build | Needs | What SOMM gets | Key limits |
| --- | --- | --- | --- | --- |
| CSV / Exportify CSV | ✅ working | nothing | title, artists, album, duration, ISRC, date, explicit, genres, instruments, mood, tags, BPM, Spotify/YouTube/Apple URLs | 2 MB, 5,000 rows |
| M3U / M3U8 | ✅ working | nothing | `#EXTINF` artist/title/duration (paths/URLs ignored and never fetched) | same |
| XSPF | ✅ working | nothing | title, creator, album, duration, ISRC identifier (DTD/entities rejected) | same |
| JSON (SOMM export or array) | ✅ working | nothing | as CSV | same |
| Pasted list | ✅ working | nothing | “Artist - Title”, “Title by Artist”, tab-separated | same |
| Manual entry | ✅ working | nothing (song search needs MusicBrainz) | title, artist, album, year, your genre | 500 per batch |
| Spotify | ✅ implemented, mock-tested · 🔑 credentials | `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` | tracks, artists, album, duration, ISRC, explicit; artist-level genres (deprecated field) | owned/collaborative playlists only; dev mode 5 users |
| YouTube / YouTube Music | ✅ implemented, mock-tested · 🔑 credentials | `YOUTUBE_API_KEY` | video titles + channel → parsed artist/title | public/unlisted only; 30-day retention |
| Apple Music | ✅ implemented, mock-tested · 🔑 credentials | Apple Developer Program key (`APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `.p8` path) | catalogue `genreNames`, ISRC, album, duration | library playlists need MusicKit user token + subscription |
| MusicBrainz (enrichment) | ✅ implemented, mock-tested · ⏳ live run needs contact | `MUSICBRAINZ_CONTACT` | community genres, instrument credits, tags, first release date, recording/artist MBIDs | ≈1 request/s; tags/genres CC BY-NC-SA |
| iTunes Search (enrichment) | ✅ live lookup verified (2026-10-13) | `ITUNES_LOOKUP_ENABLED=true` | primary store genre + store link | ≈20 calls/min; promotional-use terms |

## Spotify Web API

Verified sources: [February 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026),
[February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide),
[March 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/march-2026),
[Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items),
[Get Artist](https://developer.spotify.com/documentation/web-api/reference/get-an-artist),
[Nov 2024 changes](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api),
[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

* **Auth:** Authorization Code with PKCE, scopes `playlist-read-private playlist-read-collaborative`. No client
  secret is used. Tokens are stored AES-256-GCM-encrypted and refreshed server-side.
* **Playlist contents:** `GET /playlists/{id}/items` (the `/tracks` endpoints were removed for development-mode
  apps — new apps from 2026-02-11, existing apps migrated 2026-03-09). Items are returned **only for playlists the
  user owns or collaborates on**; other playlists return metadata only (403 for items). Each item’s track is in
  `item` (`track` is deprecated; SOMM reads both).
* **Development mode:** the app owner needs Spotify Premium; at most **5** allow-listed users for new apps.
  Extended quota is limited to organisations (May 2025; secondary sources cite ≥ 250k MAU — not confirmed on the official page).
* **Removed for new apps (Nov 2024):** audio features, audio analysis, recommendations, related artists — SOMM does
  not request or claim tempo/energy from Spotify. Batch `GET /artists` was removed in 2026, so artist genres are
  fetched individually (first 50 artists) and stored as `provided` metadata from `spotify:artist` at confidence 0.6;
  the field is deprecated and often empty. `external_ids` (ISRC) remains available (March 2026 revert).
* **Fallback:** for playlists you don’t own (or users beyond the dev-mode allow-list), export with a tool such as
  Exportify and import the CSV — SOMM detects the format, treats its “Artist Genres” as Spotify-provided metadata
  and splits multiple artists on commas (a name containing a comma will be split; documented limitation).
* **Redirect URI:** must match exactly; Spotify requires loopback IP literals (`http://127.0.0.1:8787/...`) rather
  than `localhost` for local development.

## YouTube Data API v3

Verified sources: [playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list),
[Getting started](https://developers.google.com/youtube/v3/getting-started),
[Developer Policies](https://developers.google.com/youtube/terms/developer-policies).

* API-key (unauthorised) requests retrieve public data; `playlistItems.list` costs 1 quota unit, `maxResults ≤ 50`.
  Default quota: 10,000 units/day for most endpoints.
* YouTube provides titles and channel names, not song metadata. SOMM parses “Artist - Title”, strips
  “(Official Video)” etc., uses “Artist - Topic” channels as the artist, and flags low-confidence parses for review.
  Genres come from MusicBrainz lookups, never from YouTube.
* Private/deleted videos are skipped and counted. “Mix” lists (`RD…`), “Liked videos” (`LL`) and “Watch later”
  (`WL`) are rejected with an explanation. YouTube Music `music.youtube.com/playlist?list=` URLs use the same IDs.
* **Retention:** Developer Policies III.E.4 require stored API data to be refreshed or deleted within 30 calendar days;
  YouTube-derived playlists get `data_expires_at = now + 30 days` and are deleted by housekeeping.
* **Policy note for review:** III.E.4.h restricts creating “new or derived data or metrics” from API data. SOMM uses
  YouTube only to read which songs are in the user’s own playlist and resolves them against MusicBrainz; a
  policy review is recommended before enabling YouTube import publicly.

## Apple Music API and iTunes Search

* Apple’s MusicKit documentation pages render client-side and could not be fetched verbatim. Requirements
  implemented (and to be re-verified before enabling): paid **Apple Developer Program** membership, a MusicKit
  identifier and `.p8` key; ES256-signed developer token (SOMM uses a 12-hour lifetime; Apple’s maximum is about six
  months); catalogue playlists (`pl.…`) need only the developer token; library playlists (`p.…`) also need a Music User
  Token from MusicKit JS and an active Apple Music subscription. `genreNames` (minus the store-level “Music”) are stored
  as provided metadata. **Not tested live.**
* **iTunes Search API** ([terms page](https://performance-partners.apple.com/search-api)): public, ≈20 calls/minute;
  promotional content (artwork, previews) may only be used to promote store content. SOMM uses only
  `primaryGenreName` plus a link back to the store, never artwork or previews, and it is off by default.
  A live lookup through SOMM’s client returned `Dance` with a store link on 2026-10-13
  (`npm run smoke:metadata -- "Daft Punk" "Digital Love"`).

## MusicBrainz (enrichment)

Verified sources: [Rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting),
[Data licence](https://musicbrainz.org/doc/About/Data_License),
[Database (core vs supplementary)](https://musicbrainz.org/doc/MusicBrainz_Database).

* **Rate limit:** on average 1 request/second per source IP; exceeding it yields 503 for all requests. SOMM spaces
  requests 1.1 s apart, backs off 5 s on 503/429, caches results (30 days for hits, 7 for misses) and enriches each
  canonical track once for all users.
* **User-Agent:** must identify the application with a contact. SOMM sends `SOMM/0.1.0 ( <MUSICBRAINZ_CONTACT> )`
  and stays disabled until a contact is configured (it will not send a fake one).
* **Lookup:** recording by known MBID → by ISRC → by search (score ≥ 85, exact normalised title and artist, length
  within 10 s). Unmatched tracks are marked `not_found` — nothing is guessed.
* **Stored:** top recording genres (votes → confidence 0.4–0.9), artist-level genres as fallback (×0.8 confidence),
  instrument credits from performer relationships (`credited`, 0.95), mapped tags as `community` attributes,
  unmapped descriptive tags (junk filtered), first release year and recording/artist MBIDs.
* **Licence:** core data (recordings, artists, relationships incl. instrument credits) is CC0; **tags and genre
  associations are supplementary data under CC BY-NC-SA 3.0** — attribution is shown in the UI, and any commercial
  deployment needs a separate arrangement with MetaBrainz.

## Import workflow

1. `POST /api/imports/preview` → parse + classify; returns every entry with status `new`, `duplicate`
   (skipped by default), `alternate_version`, `in_library` or `review`, unreadable rows with reasons, and
   source notes. Nothing is stored except a 1-hour draft.
2. `POST /api/imports/:draftId/commit` with name, visibility and row choices → canonical tracks, playlist
   entries, job, first profile.
3. `GET /api/imports/jobs/:id` → progress counts (pending / enriched / not found / error / skipped), genre
   coverage, row errors and lookup failures; `POST …/retry` re-queues failed or skipped lookups.

Errors are structured (`invalid_input`, `empty`, `too_large`, `needs_credentials`, `needs_connection`,
`not_authorized`, `not_found`, `rate_limited`, `provider_unavailable`). Outbound requests retry 429/502/503/504
with `Retry-After` (bounded) and time out after 15 s.

### CSV columns (case-insensitive aliases)

| Field | Accepted headers |
| --- | --- |
| title* | title, track, track name, song, song name, song title, name, track title |
| artist* | artist, artists, artist name, artist name(s), performer, track artist, creator |
| album | album, album name, album title, release |
| duration | duration, duration (ms), duration_ms, track duration (ms), length, time (`mm:ss`, `h:mm:ss`, seconds or ms) |
| isrc | isrc |
| date | year, release date, release_date, album release date, date, released |
| genre | genre, genres, artist genres (split on `; , / \|`) |
| explicit | explicit (true/false/yes/no/1/0) |
| bpm | bpm, tempo |
| instruments / mood / tags | instruments, instrument / mood, moods / tags, tag |
| uri | track uri, spotify uri, uri, url, link, spotify url, track url |

Multiple artists: split on `;`, `|`, ` / ` and “feat.” — never on `&` or `,` (except Exportify files).

## Adding a provider

Implement a function returning `RawPlaylist` (see `src/server/import/types.ts`), add a URL parser to
`urls.ts` if needed, add a status entry in `ProviderService.statuses`, a case in `services/imports.ts`, and
mocked tests in `tests/integration/providers.test.ts`.

## Smoke test

```bash
MUSICBRAINZ_CONTACT="you@example.org" npm run smoke:metadata -- "Artist" "Title"
```
