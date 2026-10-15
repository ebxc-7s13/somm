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
| Spotify account-data export (`Playlist1.json`, `YourLibrary.json`) | ✅ working | nothing (the user requests it from Spotify) | title, artist, album, Spotify track link; local files; episodes/audiobooks skipped with a reason | import: 2 MB, combined into one playlist; converter: 12 MB, one CSV per playlist |
| Apple Music / iTunes “Export Playlist” text | ✅ working | nothing | name, artist, album, genre, year, time (UTF-16, tab-separated; `Location` paths ignored) | 2 MB, 5,000 rows |
| Pasted list | ✅ working | nothing | “Artist - Title”, “Title by Artist”, tab-separated; a pasted table with a header row is read as CSV | same |
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

## Playlist → CSV converter

`/convert` (no account needed) turns any source above into SOMM's CSV format — one row per song — so a listener
can check and fix every song, download the file, and import that same file:

1. `POST /api/convert` with a file/pasted source (`csv`, `m3u`, `xspf`, `json`, `text`) or, when signed in, a
   playlist link (`spotify`, `youtube`, `apple_music`; only works when that provider is configured). It reuses the
   import adapters and returns `{ playlists: [{ name, rows, errors, notes }], stored: false }`. Nothing is written to
   the database; requests are rate-limited (30 per 10 minutes per user or IP).
2. The page shows an editable sheet (title, artist, album, genre, year), flags rows missing a title or artist, and
   writes the CSV in the browser (`src/shared/csv.ts`): columns `title, artist, album, genre, year, duration, isrc,
   bpm, instruments, mood, tags, link`, multiple values separated by `; `, RFC 4180 quoting, CRLF, UTF-8 BOM.
   Cells starting with `= + - @` get a leading apostrophe so spreadsheets do not run them as formulas; the CSV
   importer removes it again.
3. **Download CSV**, **Copy CSV**, or **Import this CSV**, which hands the identical CSV text to the import page
   (`/import?from=convert`, via `sessionStorage` in the same tab) for the normal preview → commit → enrichment flow.

A test proves the round trip: converted rows → CSV → import preview yields the same songs and fields.

### Exporting playlists with an external tool (TuneMyMusic)

Most music apps cannot download a playlist. The landing, Convert and Import pages therefore show a large guide that
points listeners to an external playlist tool, [TuneMyMusic](https://www.tunemymusic.com/home): the listener signs in
to their music service **on TuneMyMusic's site** (never on SOMM), chooses to export to a file, downloads the CSV, and
uploads it to Convert (to check and complete every song) or Import (straight onto the map). TuneMyMusic is an
independent service; its own terms and any plan limits apply, and SOMM receives nothing from it except the file the
listener uploads. Checked 2026-10-14: its site offers transfers between services and exports to a CSV or TXT file.
The exact column names of its export were not verified; SOMM reads any CSV with a title and an artist column (see
the aliases below).

**Several playlists in one CSV.** Export tools may write every playlist into one file with the playlist's name in a
column (`playlist name`, `playlist`, `playlist title`). The converter splits such a file into one playlist — one CSV —
per name, in order of first appearance; rows without a name go into a playlist named after the file. Row numbers in
errors still refer to the original file. Converter CSV uploads may be up to 12 MB and 50,000 rows, and each playlist
must fit one import (5,000 songs). The importer keeps one playlist per file and adds a note when the file held
several, pointing to the converter.

### Pasted names and links

The converter reads pasted lists forgivingly (the import page stays strict): “Artist - Title”, video titles such as
“Artist - Song (Official Video) [4K]” (cleaned), quoted “Title” by Artist, Title⇥Artist, and plain song titles. Track
numbers and durations copied with the names are skipped. Rows without an artist are kept for song matching.

Track links (on their own or mixed with names) are turned into names through each service's official **oEmbed** endpoint (public, no key;
checked 2026-10-14 that none of the oEmbed paths is disallowed by the services' robots.txt), up to 300 links at a time:

| Link | What oEmbed gives | Result |
| --- | --- | --- |
| Spotify track (`open.spotify.com/track/…`, `spotify:track:…`) | song title only | title-only row (artist via matching or typed) |
| YouTube / YouTube Music video | video title + channel | artist and title parsed as for YouTube imports |
| SoundCloud track | “Title by Uploader” + uploader | title; artist from “Artist - Title” or the uploader (flagged) |
| Spotify playlist/album, YouTube playlist, SoundCloud set | nothing (oEmbed never lists contents) | an explanation: copy the track links instead (Spotify app: Ctrl+A, Ctrl+C), or use the YouTube playlist option |

SOMM does not use YouTube's playlist RSS feed: `robots.txt` on youtube.com disallows `/feeds/videos.xml`, and pages
are never scraped.

### Find song details (MusicBrainz)

`POST /api/convert/match` (no account; up to 5 rows per request, 120 requests per hour per user or IP) completes rows
from MusicBrainz and returns, per row, the fields it can fill, a status and the recording's MusicBrainz page. The
page sends rows in batches with a progress bar and a Stop button; only empty cells are filled.

* **Title + artist:** recording search (100 results — classic songs have hundreds of recordings) with title and
  artist; SOMM itself checks that each candidate has the same title (“(Official Video)”, “(4K Remaster)” etc. are
  ignored) and credits the artist, so low search scores are accepted (a duet credited “A & B” scores below A's later
  solo re-recording). A multi-artist credit (“A, B”) is retried with its first name. The **original** is chosen by
  leaving out music videos and other versions (live, remix, acoustic, instrumental…, unless the listener's title names
  one), then taking the **earliest release year**, and within that year the recording found on the most releases
  (year-only dates on obscure compilations would otherwise win). Its earliest album, single, EP or soundtrack (film
  songs live on soundtracks) gives the album. Status `matched`.
* Checked live on 2026-10-14 against MusicBrainz: Blinding Lights (2019 single, synth-pop), Die With a Smile (2024
  duet single), Shape of You (2017 single), Bohemian Rhapsody (*A Night at the Opera*, 1975), Never Gonna Give You Up
  (*Whenever You Need Somebody*, 1987), Kesariya and Tum Hi Ho (their film soundtracks), APT. (2024 single) all
  matched the original recording with an ISRC.
* **Title only** (e.g. Spotify links, whose oEmbed gives no artist): MusicBrainz search has no popularity ranking,
  and popular titles have hundreds of covers (verified live: the original “Blinding Lights” is not among the first 100
  title-only results, and ListenBrainz popularity over those results favours covers too). So: if every strong
  MusicBrainz match shares one artist, that artist is used. Otherwise SOMM asks **Wikidata** (CC0; its search ranks
  well-known items first) for the best-known song item with exactly that title — skipping films, albums, music videos —
  and takes the performer from its description (“2020 single by Dua Lipa featuring …”) or its performer claim (P175).
  The suggestion is used only if MusicBrainz then confirms that performer recorded the title; such rows are marked
  `check`. If MusicBrainz cannot confirm, the row is `needs_artist` with the suggestion in its message.
  Checked live 2026-10-14 with titles only: Blinding Lights → The Weeknd, Shape of You → Ed Sheeran, Flowers → Miley
  Cyrus, Levitating → Dua Lipa, Believer → Imagine Dragons, Tum Hi Ho → Arijit Singh (*Aashiqui 2*), Bohemian
  Rhapsody → Queen; “Perfect” → Anne-Marie (Wikidata's top item, not Ed Sheeran's) — the reason these rows say
  *Check*.
* **Genre:** MusicBrainz's curated recording genres, else the artist's genres (`weightGenres`, top 3). Free-form tags
  are not used — they are noisy (the same original is tagged “jazz” and “trance”).
* Year (first release date) and ISRC are filled when empty. Lookups are cached in memory only; nothing the listener
  converts is stored. The shared MusicBrainz client keeps to about one request per second for the whole server.

In production the MusicBrainz contact defaults to the project page (`PROJECT_URL` in `src/server/config.ts`) when
`MUSICBRAINZ_CONTACT` is not set, so matching and import enrichment work without a personal email.

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
| playlist | playlist name, playlist, playlist title (the converter makes one CSV per playlist) |

Multiple artists: split on `;`, `|`, ` / ` and “feat.” — never on `&` or `,` (except Exportify files).

## Adding a provider

Implement a function returning `RawPlaylist` (see `src/server/import/types.ts`), add a URL parser to
`urls.ts` if needed, add a status entry in `ProviderService.statuses`, a case in `services/imports.ts`, and
mocked tests in `tests/integration/providers.test.ts`.

## Smoke test

```bash
MUSICBRAINZ_CONTACT="you@example.org" npm run smoke:metadata -- "Artist" "Title"
```
