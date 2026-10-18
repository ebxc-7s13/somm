-- Tree notifications: the newest chat message each member has seen (unread counts).
CREATE TABLE community_reads (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (community_id, user_id)
);

-- Playlists a member shares with a Tree: the other members can open the song list.
-- Sharing never changes the playlist's own visibility; leaving the Tree removes the share.
CREATE TABLE community_shares (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  playlist_id  TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (community_id, playlist_id)
);
CREATE INDEX community_shares_user ON community_shares(user_id);

-- Chat messages can now point at a shared playlist.
ALTER TABLE community_messages DROP CONSTRAINT IF EXISTS community_messages_ref_type_check;
ALTER TABLE community_messages ADD CONSTRAINT community_messages_ref_type_check CHECK (ref_type IN ('track', 'artist', 'album', 'playlist'));
