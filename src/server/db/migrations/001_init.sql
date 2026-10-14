-- SOMM initial schema (PostgreSQL 15+; PGlite locally). See docs/DATA_MODEL.md for the
-- privacy class of every table. Timestamps are ISO-8601 UTC strings (sortable as text).
-- IDs are random URL-safe strings unless noted. Flags are 0/1 integers.

-- ---------------------------------------------------------------- accounts
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  handle             TEXT NOT NULL UNIQUE CHECK (handle = lower(handle)),
  display_name       TEXT NOT NULL,
  password_hash      TEXT,                 -- NULL for temporary demo accounts
  is_demo            INTEGER NOT NULL DEFAULT 0, -- 0 real, 1 temporary demo visitor, 2 seeded fictional listener
  bio                TEXT NOT NULL DEFAULT '',
  profile_visibility TEXT NOT NULL DEFAULT 'private' CHECK (profile_visibility IN ('private', 'members', 'public')),
  discoverable       INTEGER NOT NULL DEFAULT 0,
  show_memberships   INTEGER NOT NULL DEFAULT 0,
  onboarded          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  expires_at         TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,               -- SHA-256 of the cookie token; the token itself is never stored
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE provider_connections (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  access_token_enc  TEXT NOT NULL,           -- AES-256-GCM, never returned by the API
  refresh_token_enc TEXT,
  scope             TEXT,
  expires_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (user_id, provider)
);

CREATE TABLE oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ------------------------------------------------- canonical music catalogue
-- Shared across users. Holds only catalogue metadata (no user data).
CREATE TABLE artists (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX artists_norm ON artists(normalized_name);

CREATE TABLE albums (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  normalized_title  TEXT NOT NULL,
  primary_artist_id TEXT REFERENCES artists(id) ON DELETE SET NULL,
  release_date      TEXT,
  artwork_url       TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX albums_norm ON albums(normalized_title, primary_artist_id);

CREATE TABLE tracks (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,           -- base title without version segments
  display_title     TEXT NOT NULL,           -- title as first imported
  normalized_title  TEXT NOT NULL,
  version           TEXT,                    -- remix | live | acoustic | ... (NULL = original)
  version_detail    TEXT,
  primary_artist_id TEXT NOT NULL REFERENCES artists(id),
  album_id          TEXT REFERENCES albums(id) ON DELETE SET NULL,
  duration_ms       INTEGER,
  release_date      TEXT,
  release_year      INTEGER,
  isrc              TEXT,
  explicit          INTEGER,
  tempo_bpm         DOUBLE PRECISION,
  tempo_source      TEXT,
  fallback_key      TEXT NOT NULL,           -- normalized title|artist|version
  enrichment_status TEXT NOT NULL DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'done', 'not_found', 'error', 'skipped')),
  enrichment_error  TEXT,
  enriched_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX tracks_fallback ON tracks(fallback_key);
CREATE INDEX tracks_isrc ON tracks(isrc);
CREATE INDEX tracks_artist ON tracks(primary_artist_id);
CREATE INDEX tracks_enrichment ON tracks(enrichment_status);

CREATE TABLE track_artists (
  track_id  TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL REFERENCES artists(id),
  role      TEXT NOT NULL CHECK (role IN ('primary', 'featured')),
  position  INTEGER NOT NULL,
  PRIMARY KEY (track_id, artist_id)
);
CREATE INDEX track_artists_artist ON track_artists(artist_id);

-- Provider-namespaced identifiers, e.g. ('spotify:track', '4uLU6h...'), ('isrc', 'GBXXX...'),
-- ('musicbrainz:recording', <mbid>), ('youtube:video', <id>), ('apple_music:song', <id>).
CREATE TABLE external_ids (
  namespace   TEXT NOT NULL,
  value       TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('track', 'artist', 'album')),
  entity_id   TEXT NOT NULL,
  url         TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (namespace, value)
);
CREATE INDEX external_ids_entity ON external_ids(entity_type, entity_id);

CREATE TABLE genres (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,               -- canonical key (see shared/taxonomy.ts)
  family TEXT NOT NULL
);

-- Catalogue-level genre assignments with provenance. User-supplied genres are
-- stored on playlist_tracks instead, so they never leak into other users' data.
CREATE TABLE track_genres (
  track_id   TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  genre_id   INTEGER NOT NULL REFERENCES genres(id),
  source     TEXT NOT NULL,                  -- spotify | apple_music | musicbrainz | itunes
  kind       TEXT NOT NULL CHECK (kind IN ('provided', 'credited', 'community', 'inferred')),
  confidence DOUBLE PRECISION NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (track_id, genre_id, source)
);
CREATE INDEX track_genres_genre ON track_genres(genre_id);

CREATE TABLE track_attributes (
  track_id   TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  value      TEXT NOT NULL,
  source     TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('provided', 'credited', 'community', 'inferred')),
  confidence DOUBLE PRECISION NOT NULL,
  evidence   TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (track_id, category, value, source)
);

-- Descriptive (non-genre, unmapped) tags, used only by the optional text-similarity component.
CREATE TABLE track_tags (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  source   TEXT NOT NULL,
  votes    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (track_id, tag, source)
);

-- Extracted results of external lookups (never raw responses), with expiry.
CREATE TABLE lookup_cache (
  key        TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  result     TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX lookup_cache_expiry ON lookup_cache(expires_at);

-- ------------------------------------------------------------- user library
CREATE TABLE playlists (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  provider        TEXT NOT NULL,
  source_ref      TEXT,
  source_url      TEXT,
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'public')),
  track_count     INTEGER NOT NULL DEFAULT 0,
  data_expires_at TEXT,                      -- provider data that must be refreshed or deleted (YouTube: 30 days)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX playlists_user ON playlists(user_id);

-- One row per imported playlist entry. The same canonical track can appear in
-- many playlists; raw_* fields keep what the source actually said.
CREATE TABLE playlist_tracks (
  id              TEXT PRIMARY KEY,
  playlist_id     TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id        TEXT NOT NULL REFERENCES tracks(id),
  position        INTEGER NOT NULL,
  raw_title       TEXT NOT NULL,
  raw_artist      TEXT NOT NULL,
  raw_album       TEXT,
  source_track_id TEXT,                      -- provider-namespaced, e.g. spotify:track:xyz
  source_url      TEXT,
  match_method    TEXT NOT NULL,             -- provider_id | isrc | title_artist | new
  hidden          INTEGER NOT NULL DEFAULT 0, -- excluded from public listings by the owner
  user_genres     TEXT,                      -- JSON array, from the user's own file
  user_attributes TEXT,                      -- JSON array of {category,value}
  user_bpm        DOUBLE PRECISION,
  added_at        TEXT NOT NULL
);
CREATE INDEX playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
CREATE INDEX playlist_tracks_track ON playlist_tracks(track_id);

CREATE TABLE import_drafts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX import_drafts_user ON import_drafts(user_id);

CREATE TABLE import_jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('enriching', 'done', 'partial', 'failed')),
  total       INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  merged      INTEGER NOT NULL DEFAULT 0,
  message     TEXT,
  errors      TEXT,                          -- JSON array of {row, message}
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX import_jobs_user ON import_jobs(user_id, created_at);

-- ---------------------------------------------------------------- profiles
-- scope 'all'    = every playlist (only ever shown to the owner)
-- scope 'shared' = playlists marked shared/public (used for matching others and Tree aggregates)
CREATE TABLE music_profiles (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('all', 'shared')),
  input_hash    TEXT NOT NULL,
  track_count   INTEGER NOT NULL,
  profile_json  TEXT NOT NULL,
  map_json      TEXT,
  insights_json TEXT,
  vector_json   TEXT NOT NULL,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, scope)
);

-- Inverted indexes over the *shared* scope, for candidate generation and IDF.
CREATE TABLE profile_artists (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id TEXT NOT NULL,
  weight    DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (user_id, artist_id)
);
CREATE INDEX profile_artists_artist ON profile_artists(artist_id);

CREATE TABLE profile_tracks (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX profile_tracks_track ON profile_tracks(track_id);

CREATE TABLE profile_genres (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  genre_key TEXT NOT NULL,                   -- canonical genre or "family:<family>"
  PRIMARY KEY (user_id, genre_key)
);
CREATE INDEX profile_genres_key ON profile_genres(genre_key);

CREATE TABLE music_matches (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('community', 'user')),
  target_id   TEXT NOT NULL,
  input_hash  TEXT NOT NULL,
  score       DOUBLE PRECISION NOT NULL,
  label       TEXT NOT NULL,
  result_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);

-- ------------------------------------------------------------- communities
CREATE TABLE communities (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'archived')),
  origin        TEXT NOT NULL CHECK (origin IN ('cluster', 'member')),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  color         TEXT NOT NULL,
  glyph_seed    TEXT NOT NULL,
  profile_json  TEXT,                        -- k-anonymised display aggregate
  vector_json   TEXT,                        -- aggregate vector (member fractions) for matching
  member_count  INTEGER NOT NULL DEFAULT 0,
  candidate_ids TEXT,                        -- JSON: users a proposed Tree is suggested to
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE community_memberships (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('moderator', 'member')),
  joined_at    TEXT NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX memberships_user ON community_memberships(user_id);

CREATE TABLE community_name_proposals (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (community_id, name)
);

CREATE TABLE community_name_votes (
  proposal_id TEXT NOT NULL REFERENCES community_name_proposals(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (proposal_id, user_id)
);

CREATE TABLE community_messages (
  id            BIGSERIAL PRIMARY KEY,         -- monotonic: clients fill gaps with ?after=<id>
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  reply_to_id   BIGINT REFERENCES community_messages(id) ON DELETE SET NULL,
  ref_type      TEXT CHECK (ref_type IN ('track', 'artist', 'album')),
  ref_id        TEXT,
  ref_label     TEXT,
  link_url      TEXT,
  link_provider TEXT,
  hidden        INTEGER NOT NULL DEFAULT 0,
  hidden_reason TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX messages_community ON community_messages(community_id, id);
CREATE INDEX messages_user ON community_messages(user_id);

-- ------------------------------------------------------------------ safety
CREATE TABLE blocks (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('block', 'mute')),
  created_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, target_user_id, kind)
);
CREATE INDEX blocks_target ON blocks(target_user_id);

CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('message', 'user', 'community')),
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'self_harm', 'copyright', 'other')),
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at  TEXT NOT NULL,
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX reports_target ON reports(target_type, target_id);

-- ------------------------------------------------------------------- calls
CREATE TABLE calls (
  id           TEXT PRIMARY KEY,
  caller_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
  media        TEXT NOT NULL CHECK (media IN ('audio', 'video')),
  status       TEXT NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'rejected', 'missed', 'failed')),
  end_reason   TEXT,
  created_at   TEXT NOT NULL,
  answered_at  TEXT,
  ended_at     TEXT
);
CREATE INDEX calls_users ON calls(caller_id, callee_id);
