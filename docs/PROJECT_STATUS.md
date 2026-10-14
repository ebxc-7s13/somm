# Project status (2026-10-14)

Legend: ✅ done and verified · 🧪 implemented, verified with automated mocks only · 🔑 blocked on credentials ·
🟡 partially verified · ⏳ not started

## Features

| Feature | Status | Notes |
| --- | --- | --- |
| Landing page, design system, typographic logo | ✅ | browser-verified desktop + mobile |
| Accounts (handle + password), demo mode, sessions | ✅ | |
| File imports: CSV, Exportify, M3U, XSPF, JSON, pasted, manual | ✅ | |
| Spotify data-export JSON and Apple Music/iTunes playlist exports | ✅ | parsed with fictional samples of each format; not yet tried with a real export file |
| Playlist → CSV converter (`/convert`, no account needed) | ✅ | editable sheet, download/copy, hands the same CSV to import; nothing stored |
| Preview with duplicates / versions / unreadable rows | ✅ | |
| Canonical tracks, dedupe, versions, provenance | ✅ | |
| Song library + song detail | ✅ | |
| MusicBrainz enrichment | 🧪 / 🔑 | needs `MUSICBRAINZ_CONTACT` for a live run |
| iTunes primary-genre fallback | ✅ | one live lookup verified; off by default |
| Spotify import (OAuth PKCE, owned/collaborative playlists) | 🧪 / 🔑 | needs a Spotify app; dev-mode limits apply |
| YouTube import (public playlists) | 🧪 / 🔑 | needs an API key; policy review recommended |
| Apple Music import | 🧪 / 🔑 | needs Apple Developer Program; MusicKit JS login flow UI not wired (server endpoints exist) |
| Music Map (layout, LOD, interactions, list view) | ✅ | |
| Your Music Mind (evidence-backed insights) | ✅ | |
| Transparent matching + configurable weights | ✅ | |
| Trees: recommend, explain, cluster proposals, create, join/leave, names, related, k-anonymous map | ✅ | |
| Social discovery: search, similar listeners, public profiles, comparison | ✅ | |
| Privacy controls, export, deletion | ✅ | |
| Tree chat (realtime, replies, refs, links, moderation, rate limits) | ✅ | |
| Block / mute / report / moderation queue | ✅ | admin UI is minimal (API + per-message actions) |
| 1:1 voice/video calls | 🟡 | signalling/authorisation tested on a real WS server; UI built; real two-device media **not verified**; no TURN configured |
| Group calls | ⏳ | intentionally not built (cost/complexity) |
| PostgreSQL storage (Neon in production, PGlite locally) | ✅ | all tests on PGlite; production bundle verified against Neon |
| Installable web app (PWA: manifest, icons, service worker, install prompt) | 🟡 | served and sandbox-tested; installing on a device not yet verified |
| Free hosting (Render + Neon) | ✅ | live at <https://soundofmymind.onrender.com>; anonymous smoke test passed 2026-10-14 (pages, converter, demo Trees, manifest/service worker/icons, WebSocket and API auth gates) |
| Continuous deployment | ✅ | CI deploys `main` to Render through the deploy hook only after all checks pass, then confirms `/api/health` reports the new commit (verified with `b541d56`) |
| Android APK (Capacitor shell, cloud-built and signed) | 🟡 | release `android-6` (0.1.6) published with install notes and SHA-256; anonymous download, server URL and signing key verified; installing on a phone is the owner's check |

## Known limitations

* Artists without external IDs are identified by normalised name (namesakes merge).
* Exportify CSVs split artists on commas (names containing commas split).
* Tempo/energy are only available from user files (no permitted provider source).
* No email, so no password recovery; no 2FA.
* In-memory rate limiting and WebSocket fan-out assume a single instance.
* On Render's free plan the app sleeps after 15 idle minutes; the next visit waits ~1 minute.
* The Android app needs a connection (it opens the hosted site); it shows a retry page while the server wakes.
* Apple Music library import requires a MusicKit JS sign-in screen that is not yet built (catalogue playlist URLs work once configured).
* The map is SVG; extremely large libraries are capped (160 artists / 600 tracks shown, rest collapsed and listed).

## Recommended next steps

1. Set `MUSICBRAINZ_CONTACT` and run `npm run smoke:metadata`, then import a real playlist to validate enrichment quality.
2. Register a Spotify app (dev mode) and test with an allow-listed account; same for a YouTube API key.
3. Configure TURN and test a real call between two devices (phone + laptop) — then mark calls ✅ or document failures.
4. Add an optional recovery code at sign-up.
5. Collect consented engagement data to validate match weights (MATCHING_ALGORITHM.md §Validation plan).
6. Add Playwright end-to-end browser tests and an admin moderation page.
7. Legal review: MusicBrainz NC licence, YouTube derived-data clause, privacy notice.
