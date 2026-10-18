# Data model

Migration: `src/server/db/migrations/001_init.sql` (applied automatically on start; `npm run db:migrate`).
All timestamps are ISO-8601 UTC strings. IDs are random URL-safe strings unless noted.

## Privacy classes

| Class | Meaning |
| --- | --- |
| **Secret** | Never leaves the server (hashes, encrypted tokens). |
| **Private** | Visible only to the owner. |
| **Shareable** | Used for others only in aggregated or anonymised form, and only when the owner opts in. |
| **Public (opt-in)** | Shown to others only when the owner chooses. |
| **Catalogue** | Public music metadata shared across users (no user data). |
| **Community** | Visible to members of one Tree. |

## Tables

### Accounts

| Table | Purpose | Class |
| --- | --- | --- |
| `users` | handle, display name, optional bio, `password_hash` (scrypt), `is_demo` (0 real, 1 24-h demo visitor, 2 fictional seeded listener), `profile_visibility` (private / members / public), `discoverable`, `show_memberships`, `onboarded`, `expires_at` | handle/display name: public; settings: private; hash: secret |
| `sessions` | SHA-256 of the session token (the token itself is never stored), expiry | Secret |
| `provider_connections` | per user+provider OAuth tokens encrypted with AES-256-GCM, scope, expiry | Secret |
| `oauth_states` | PKCE verifier + state for in-flight OAuth (deleted after 10–15 min) | Secret |

### Catalogue (shared, no user data)

| Table | Purpose |
| --- | --- |
| `artists` | name + normalised name |
| `albums` | title, primary artist, release date, artwork URL (provider-hosted, not copied) |
| `tracks` | canonical recording: base title, display title, `version` (remix/live/acoustic/…), primary artist, album, duration, release date/year, ISRC, explicit, tempo (+source), `fallback_key`, enrichment status |
| `track_artists` | primary/featured credits with order |
| `external_ids` | provider-namespaced IDs (`spotify:track`, `isrc`, `musicbrainz:recording`, `youtube:video`, `apple_music:song`, `itunes:track`, `spotify:artist`, `musicbrainz:artist`) with optional URL; PK `(namespace, value)` |
| `genres` | canonical genre key + family (taxonomy) |
| `track_genres` | catalogue genres with `source`, `kind` (provided / credited / community / inferred) and `confidence` |
| `track_attributes` | instruments, vocals, texture, mood, rhythm, production — with source, kind, confidence, evidence |
| `track_tags` | descriptive tags not mapped to genres/attributes (optional text component) |
| `lookup_cache` | *extracted* lookup results (never raw responses) with expiry |

Canonical tracks are removed by `pruneOrphans` once no playlist references them, so deleting your data
also removes catalogue rows only you introduced.

### Library (owned by one user)

| Table | Purpose | Class |
| --- | --- | --- |
| `playlists` | name, provider, source ref/URL, `visibility` (private / shared / public), `data_expires_at` (YouTube 30-day rule) | Private; listed only if public |
| `playlist_tracks` | one row per imported entry: canonical `track_id`, position, **raw** title/artist/album as imported, source ID/URL, `match_method`, `hidden`, and the user’s own `user_genres` / `user_attributes` / `user_bpm` | Private |
| `import_drafts` | 1-hour preview drafts | Private |
| `import_jobs` | status, totals, skipped, merged, row errors | Private |

User-typed genres and attributes are stored on the **entry**, not the shared track, so one person’s labels
never change another person’s data.

### Profiles and matching

| Table | Purpose | Class |
| --- | --- | --- |
| `music_profiles` | per user × scope (`all`, `shared`): input hash, track count, profile JSON, map JSON (`all` only), insights JSON, match vector JSON | `all`: private; `shared`: shareable |
| `profile_tracks`, `profile_artists`, `profile_genres` | inverted indexes over the **shared** scope only (candidate generation, IDF) | Shareable (never exposed directly) |
| `music_matches` | reserved cache for match results (currently computed on demand) | Private |

### Communities

| Table | Purpose | Class |
| --- | --- | --- |
| `communities` | Tree name, slug, description, status (proposed / active / archived), origin (cluster / member), colour + glyph seed, k-anonymised display profile JSON, aggregate vector JSON, member count, candidate IDs for proposed Trees, demo flag | Public when active |
| `community_memberships` | role (moderator / member), joined date | Community |
| `community_name_proposals`, `community_name_votes` | naming by majority vote | Community |
| `community_messages` | body, reply, track/artist/album reference, extracted link + provider, hidden flag/reason; integer IDs for gap-fill | Community |

### Safety and calls

| Table | Purpose |
| --- | --- |
| `blocks` | `kind` block (mutual hiding, no compare/calls/profile) or mute (hide their messages for you) |
| `reports` | message / user / community reports with reason, status; unique per reporter+target |
| `calls` | caller, callee, Tree, media type, status, timestamps, end reason — metadata only, never media |

## Deviations from the suggested entity list

* `providers` — static configuration in code (`ProviderService.statuses`), not a table.
* `track_metadata` — split into `track_genres`, `track_attributes` and `track_tags`, each with provenance.
* `music_profile_features`, `music_map_nodes`, `music_map_edges` — derived data stored as JSON in
  `music_profiles` (regenerated whenever the input hash changes) plus three small inverted-index tables.
  Storing every node/edge as a row would add write volume without any query that needs it.

## Identity resolution

1. provider-namespaced ID; 2. ISRC; 3. `fallback_key = normalised base title | normalised primary artist | version`,
   accepted only if durations (when both known) differ by ≤ 10 s and ISRCs (when both known) are equal;
4. otherwise a new track. Remixes, live, acoustic, remaster and other versions get different keys, so they are
never merged with the original. Artists without an external ID are matched by normalised name — two different
artists with the same name will share a record (documented limitation).

## Deletion and retention

| Data | Retention |
| --- | --- |
| Account | Until the user deletes it (`DELETE /api/me`), which cascades to everything they own |
| Imported music | Until deleted per playlist or all at once (`DELETE /api/me/library`) |
| Demo accounts | 24 hours (refused on every request once expired; housekeeping deletes them every 6 hours) |
| YouTube-derived playlists | 30 days (`data_expires_at`) per YouTube Developer Policies |
| Drafts / OAuth states / lookup cache | 1 hour / 15 minutes / 7–30 days |
| Messages | Until the author deletes them or their account |
