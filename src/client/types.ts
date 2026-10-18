/** Response shapes used by the client (mirrors the server routes). */
import type { MusicMap } from '../shared/analysis/map';
import type { MatchResult } from '../shared/analysis/similarity';
import type { Insight, MusicProfile } from '../shared/types';

export type { MusicMap, MatchResult, Insight, MusicProfile };

export interface User {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  isDemo: 0 | 1 | 2;
  profileVisibility: 'private' | 'members' | 'public';
  discoverable: boolean;
  showMemberships: boolean;
  onboarded: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export interface MeResponse {
  user: User;
  counts: { playlists: number; tracks: number; memberships: number };
  isAdmin: boolean;
}

export interface ProviderStatus {
  id: string;
  label: string;
  role: 'import' | 'enrichment';
  state: 'available' | 'connected' | 'needs_connection' | 'needs_credentials' | 'unavailable';
  summary: string;
  capabilities: string[];
  limitations: string[];
  docsUrl: string;
  verifiedAt: string;
}

export interface PreviewEntry {
  row: number;
  title: string;
  artists: string[];
  album: string | null;
  version: string | null;
  status: 'new' | 'in_library' | 'duplicate' | 'alternate_version' | 'review';
  duplicateOf: number | null;
  notes: string[];
  skipByDefault: boolean;
}

export interface PreviewResult {
  draftId: string;
  playlist: { name: string; provider: string; sourceUrl: string | null };
  summary: { total: number; toImport: number; invalid: number; duplicates: number; alternateVersions: number; inLibrary: number; needsReview: number };
  entries: PreviewEntry[];
  errors: { row: number; message: string }[];
  notes: string[];
}

export interface JobProgress {
  id: string;
  playlistId: string | null;
  playlistName: string | null;
  status: 'enriching' | 'done' | 'partial' | 'failed';
  total: number;
  skipped: number;
  merged: number;
  counts: { pending: number; done: number; notFound: number; error: number; skipped: number };
  genreCoverage: number;
  errors: { row: number; message: string }[];
  enrichmentErrors: { title: string; message: string }[];
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface LibraryTrackRow {
  id: string;
  title: string;
  version: string | null;
  artist: { id: string; name: string };
  featured: string[];
  album: { id: string; title: string | null } | null;
  year: number | null;
  durationMs: number | null;
  explicit: boolean | null;
  genres: { name: string; label: string; family: string }[];
  providers: string[];
  addedAt: string;
  enrichment: string;
  coverage: { genre: boolean; year: boolean; album: boolean; duration: boolean };
}

export interface LibraryPage {
  total: number;
  page: number;
  pageSize: number;
  tracks: LibraryTrackRow[];
}

export interface Playlist {
  id: string;
  name: string;
  provider: string;
  visibility: 'private' | 'shared' | 'public';
  track_count: number;
  source_url: string | null;
  data_expires_at: string | null;
  created_at: string;
}

export interface ProfileResponse {
  profile: MusicProfile | null;
  insights: Insight[];
  computedAt: string | null;
  inputHash: string | null;
  sharedTrackCount: number;
  pendingEnrichment: number;
}

export interface TreeSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: 'proposed' | 'active' | 'archived';
  origin: 'cluster' | 'member';
  color: string;
  glyphSeed: string;
  memberCount: number;
  isDemo: boolean;
  families: { family: string; label: string; share: number }[];
  topGenres: string[];
  isMember: boolean;
  createdAt: string;
}

export interface TreeRecommendation {
  community: { id: string; slug: string; name: string; description: string; status: string; memberCount: number; color: string; isDemo: boolean };
  match: MatchResult;
  explanation: { summary: string; points: string[] };
  isMember: boolean;
}

export interface CommunityDisplayProfile {
  memberCount: number;
  contributingMembers: number;
  trackCount: number;
  families: { family: string; label: string; share: number }[];
  genres: { name: string; label: string; family: string; share: number; members: number }[];
  artists: { id: string; name: string; members: number; genre: string | null; family: string | null }[];
  kAnonymity: number;
  note: string | null;
}

export interface TreeDetail {
  tree: TreeSummary;
  profile: CommunityDisplayProfile | null;
  map: MusicMap | null;
  match: { match: MatchResult; explanation: { summary: string; points: string[] } } | null;
  membership: { role: 'moderator' | 'member' } | null;
  related: { slug: string; name: string; color: string; memberCount: number; score: number; isMember: boolean }[];
  names: { id: string; name: string; votes: number; votedByMe: boolean }[];
}

export interface ChatMessage {
  id: number;
  communityId: string;
  author: { id: string; handle: string; displayName: string; isDemo: boolean };
  body: string | null;
  hidden: boolean;
  replyTo: { id: number; author: string; excerpt: string | null } | null;
  ref: { type: 'track' | 'artist' | 'album' | 'playlist'; id: string; label: string } | null;
  link: { url: string; provider: string | null } | null;
  createdAt: string;
  mine: boolean;
}

/** Unread messages and the newest message in one of your Trees. */
export interface TreeActivity {
  id: string;
  slug: string;
  name: string;
  unread: number;
  lastMessage: { id: number; author: string; excerpt: string; createdAt: string; mine: boolean } | null;
}

export type MyTree = TreeSummary & Pick<TreeActivity, 'unread' | 'lastMessage'>;

/** A playlist a member shared with a Tree. */
export interface SharedPlaylist {
  playlistId: string;
  name: string;
  trackCount: number;
  topArtists: string[];
  sharedBy: { handle: string; displayName: string };
  sharedAt: string;
  mine: boolean;
}

export interface SharedTrack {
  id: string;
  title: string;
  version: string | null;
  artist: string;
  album: string | null;
  year: number | null;
}

export interface Member {
  id: string;
  handle: string;
  displayName: string;
  role: string;
  joinedAt: string;
  isDemo: boolean;
  isYou: boolean;
  online: boolean;
  profileVisible: boolean;
  match: { score: number; label: string } | null;
}
