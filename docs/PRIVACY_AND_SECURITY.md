# Privacy and security

## What SOMM collects

| Data | Required? | Notes |
| --- | --- | --- |
| Handle, password hash | yes (or a 24-h demo account) | pseudonymous; no email, legal name, birth date, contacts, location or demographics |
| Display name, bio | no | free text, length-limited |
| Imported playlist metadata | for the core feature | titles/artists/albums/IDs — never audio, never local file paths |
| Provider OAuth tokens | only if you connect a provider | encrypted at rest, deletable via Disconnect |
| Tree memberships, messages, blocks, reports | if you use social features | |
| Call metadata | if you call | who/when/status — never media |

No analytics, trackers or third-party fonts/CDNs are loaded (fonts are self-hosted).

## Visibility model

| Setting | Effect |
| --- | --- |
| Playlist **private** (default) | Used only for *your* map, insights and recommendations |
| Playlist **shared for matching** | Counts anonymously toward matching scores and Tree aggregates; tracks never listed |
| Playlist **public** | Listed on your public profile (if the profile is visible) |
| Entry **hidden** | Excluded from shared and public scopes |
| Profile private / members / public | Who can see your public playlists and map |
| Discoverable (off by default) | Whether others can find you as a similar listener / include you in Tree proposals. **Reciprocal:** you see similar listeners only if you are discoverable |
| Show Trees on profile | Public profile only |

Guarantees enforced in code and tests:
* Joining a Tree never shares a private playlist (`trees-chat.test.ts` “never lets a private playlist contribute”).
* Tree pages list an artist only when ≥ 3 members contribute and ≥ 2 of them hold that artist (k-anonymity).
* Comparison names shared artists/tracks only from the other person’s **public** playlists; shared-only data
  contributes to the score as counts (`api-security.test.ts`).
* Catalogue search searches only *your* library and MusicBrainz — never SOMM’s shared catalogue (a hit could
  reveal that someone imported an obscure track).
* Blocks are mutual: hidden messages both ways, no profile, comparison, member listing or calls. Mutes hide
  messages for the muter only.

## Authentication and sessions

* Passwords: scrypt (N = 2¹⁵, r = 8, p = 1, 32-byte key, 16-byte salt), constant-time comparison, a dummy hash
  for unknown handles; minimum 10 characters. Sign-in/sign-up/demo rate-limited (10/min/IP).
* Sessions: 32-byte random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production), stored only as
  SHA-256; 30-day expiry (24 h for demo). Sign-out deletes the session.
* No email means no password recovery (documented limitation).

## Web security

* **CSRF:** mutating `/api` requests must come from an allow-listed `Origin`, must not be `Sec-Fetch-Site: cross-site`,
  and must send JSON bodies (form/text posts rejected with 415).
* **Headers:** CSP `default-src 'self'` (scripts self only; Apple MusicKit CDN added only if Apple is configured),
  `frame-ancestors 'none'`, `object-src 'none'`, nosniff, `X-Frame-Options: DENY`, COOP, Referrer-Policy,
  Permissions-Policy (camera/microphone self only), HSTS in production. API responses are `Cache-Control: no-store`.
* **XSS:** React escapes all text; `dangerouslySetInnerHTML` is banned (test). Chat links are extracted server-side,
  only `http(s)` without credentials, rendered with `rel="noopener noreferrer nofollow ugc"`. Control and bidi
  override characters are stripped from messages.
* **SSRF:** SOMM never fetches user-supplied URLs. Playlist links are parsed for IDs on allow-listed hosts
  (`open.spotify.com`, `youtube.com`/`youtu.be`/`music.youtube.com`, `music.apple.com`) and the official API is called.
  M3U/XSPF locations are ignored.
* **XML:** XSPF with `<!DOCTYPE` or `<!ENTITY` is rejected; parsing is regex-based (no entity expansion).
* **Input limits:** 3.5 MB bodies, 2 MB / 5,000-row files, 300-character fields, 1,000-character messages,
  64 KB WebSocket frames, 24 KB signalling payloads.
* **WebSocket:** cookie-authenticated upgrade with Origin check; per-connection frame rate limit (40/s);
  subscriptions require membership; heartbeats terminate dead connections.

## Secrets

* Provider tokens: AES-256-GCM with `TOKEN_ENCRYPTION_KEY` (32 bytes). In development without a key an ephemeral key
  is generated (tokens die on restart); in production provider connections are disabled without a key.
* `.env` is git-ignored; `.env.example` holds placeholders only (tested). Client code never references server
  secrets and the built bundle is scanned for configuration names (tested). Tokens and password hashes are never
  returned by the API or included in exports (tested).
* The Apple `.p8` key is read from a path outside the repository.

## Authorisation

Every user-specific query filters by the session user (`p.user_id = ?`). Other users get **404** (not 403) for
playlists, entries, tracks and jobs, so existence is not leaked. Tree chat, member lists and naming require
membership; moderator actions require the moderator role (Tree founder, then the longest-standing member) or an
admin handle (`ADMIN_HANDLES`). Cross-user isolation is covered by `api-security.test.ts`.

## Moderation and abuse

* Message rate limits: 5 per 10 s and 120 per hour per user; report limit 20/hour; call invites 6/minute.
* Reports (spam, harassment, hate, sexual, self-harm, copyright, other) are unique per reporter+target. A message
  reported by 3 different members is hidden automatically pending review. Moderators can hide/restore/dismiss;
  authors can delete their own messages.
* Fictional demo listeners cannot sign in, receive calls or be impersonated (reserved `demo-` prefix).

## Deletion, export and retention

* `GET /api/me/export` — all stored data as JSON (no tokens, no hash).
* `DELETE /api/me/library` — all playlists, profiles, matches, jobs; orphaned catalogue rows are pruned.
* `DELETE /api/me` (type your handle) — account and everything it owns (cascade), Trees recomputed.
* Disconnect provider — deletes its tokens immediately.
* Housekeeping every 15 min: expired sessions, drafts, OAuth states, cache, 24-h demo accounts, YouTube data past 30 days.

## Known gaps

* No email recovery or 2FA (by design for minimal PII; add an optional recovery code next).
* In-memory rate limits are per process; a multi-instance deployment needs a shared store.
* No admin console beyond the report queue API/UI.
* Calls without TURN may fail on symmetric NATs; media is peer-to-peer (IP addresses are visible to the peer, as in
  any WebRTC call) — document this in the user-facing call prompt before wide release.
* A formal legal/privacy review (GDPR basis, YouTube policy III.E.4.h, MusicBrainz NC licence) is recommended
  before public launch.
