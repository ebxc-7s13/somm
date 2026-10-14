# Music analysis

All analysis code is in `src/shared/analysis/` — pure, deterministic TypeScript with no network, randomness
or model. Identical input produces identical output (tested), so maps and insights are stable and cacheable
by input hash.

## Provenance model

Every genre and attribute carries a `kind`, a `source` and a `confidence` (0–1):

| Kind | Meaning | Example source | Used for matching? |
| --- | --- | --- | --- |
| `provided` | Provider catalogue metadata | Apple `genreNames`, Spotify artist genres, iTunes primary genre | yes |
| `credited` | Explicit credit relationship | MusicBrainz performer → instrument | yes (attributes) |
| `community` | Community votes | MusicBrainz genre votes, mapped tags | yes if confidence ≥ 0.5 |
| `user` | Written by the user in their own file | CSV `genre`, `instruments`, `mood`, `bpm` | yes (own data) |
| `inferred` | SOMM rule from other metadata | genre “synthwave” → synthesizer | **never** (it would re-count the genre) |

User-supplied values live on the user’s playlist entries, so they affect only that user’s profile.

## Stage 1 — deterministic metadata analysis (`profile.ts`)

`computeProfile(tracks)` produces:

* **Totals** — tracks, artists (primary + featured), albums, genres, families.
* **Coverage** — share of tracks with genre, year, album, duration, any attribute, verified attribute, tempo.
* **Families / genres** — distinct-track counts and shares *relative to tracks with known genres*, sources and kinds.
* **Artists** — track counts, shares, top genres; **albums**; **decades**; year min/median/max.
* **Diversity** — normalised Shannon entropy of artist, genre and family distributions (0 = one value,
  1 = perfectly even), unique-artists-per-track, top-five-artist share.
* **Genre co-occurrence** — pairs on the same track with Jaccard strength.
* **Attributes** — per category:value, track count, share, verified vs inferred counts, mean confidence, evidence.
* **Versions**, **explicit share**, **tempo** (only from real tempo metadata), **unknown-genre count**.

Genre normalisation (`taxonomy.ts`): NFKD folding (Latin diacritics only — Devanagari vowel signs are kept),
`&` → “and”, alias table (`hiphop`, `hip-hop` → `hip hop`; `R&B`, `rnb` → `r and b`; `DnB` → `drum and bass`; …),
and a family table with keyword rules for unknown genres. Families: electronic, ambient, rock, metal, pop,
hip hop, R&B & soul, jazz, blues, classical, folk & country, Indian, Latin, reggae & Caribbean, African, world,
experimental, soundtrack, other.

### Genre-implied attributes (inference rules)

A small, documented table maps genres to *associated* attributes with modest confidence, e.g. synthwave →
synthesizer (0.6), drum and bass → breakbeats (0.55), ambient → atmospheric texture (0.5), shoegaze → wall of
sound (0.45), Hindustani/Carnatic classical → tala cycles (0.5). They are computed at analysis time (never
stored), labelled “inferred from genre ‘x’”, drawn dashed/orange on the map, phrased “associated with” in
insights, and excluded from matching.

## Stage 2 — text similarity (evaluated, kept minimal)

The prompt asked to evaluate compact embedding models. Decision: **no neural model ships.**

* The available text is short and categorical (genre names, tags, artist names). Genre names are already
  normalised and families give smoothing, so a sentence-embedding model would mostly re-encode the genre
  component and double-count it.
* A small CPU model (e.g. a MiniLM-class Sentence Transformer via ONNX Runtime) adds roughly 100 MB of runtime
  plus model files and per-record inference for little measurable gain on this data.
* Implemented instead: an optional **descriptive-tag component** — TF-IDF-weighted cosine over tokens of
  MusicBrainz tags that are *not* genres and *not* mapped attributes (so it does not overlap other components).
  Its default weight is **0**; it is visible in score breakdowns as “Disabled (weight 0)” and can be enabled with
  `MATCH_WEIGHTS`. Enabling it should follow an offline comparison on real, consented data (see MATCHING_ALGORITHM.md).

## Stage 3 — vector matching

See [MATCHING_ALGORITHM.md](MATCHING_ALGORITHM.md).

## Stage 4 — controlled summaries (`insights.ts`)

Templates turn computed numbers into sentences; nothing is generated freely and no LLM is involved.

| Insight | Rule |
| --- | --- |
| Dominant family | top family ≥ 50 % of tracks with genres (“strong preference”); 30–50 % → “most represented” |
| Breadth | ≥ 3 families each ≥ 10 % |
| Top genres | top 3 genres with ≥ 2 tracks, with sources |
| Artist focus / diversity | top-5 share ≥ 60 % → “small circle”; unique-artist ratio ≥ 0.7 → “explore widely” |
| Top artist | ≥ 3 tracks |
| Era | top decade ≥ 40 % of dated tracks, else span if ≥ 4 decades |
| Attributes | verified ≥ 3 tracks and ≥ 20 % → stated as verified; otherwise “genres associated with …” (inferred, low confidence) |
| Versions | ≥ 15 % alternate versions |
| Tempo | ≥ 5 tracks with real tempo metadata |
| Caveats | small library (< 10), unknown genres, no verified attributes |

**Confidence:** `high` if sample ≥ 20 and coverage ≥ 0.7; `medium` if ≥ 8 and ≥ 0.4; else `low`. For verified
attribute statements the coverage is the share of tracks with any verified attribute metadata.

**Never stated:** anything about intelligence, mental health, personality, morality, politics, religion, age,
gender or personal history (enforced by a test that scans generated insight text).

## Music Map layout (`map.ts`)

* **Hierarchy:** root → families (sorted by size) → genres (a family with only its namesake genre skips that
  level) → artists (each under the genre holding most of its tracks) → tracks; “Genre unknown” branch for tracks
  without genres; “+N more” nodes when caps are hit (8 genres/family, 10 artists/genre, 8 tracks/artist,
  160 artists, 600 tracks).
* **Angles:** each node’s arc is split among children half by track weight and half by leaf count, so small but
  wide branches stay readable. Start at −90°, clockwise; ties broken by name/ID → deterministic.
* **Rings:** artist ring = max(520, 34 · artists / 2π); families at 0.55×, genres at 0.8×, tracks +110,
  attribute orbit +130. Node radius ∝ √share.
* **Edges:** branch (width = child/parent track share), co-occurrence chords (Jaccard ≥ 0.1, ≥ 2 tracks, max 24),
  artist→other-genre associations (≥ 25 % of the artist’s tracks), attribute→genre links (top 3).
* **Client rendering:** memoised SVG scene; level-of-detail by zoom (tracks appear at ≥ 1.8× fit or when their
  artist is selected; labels by tier, fewer on phones); constant-size labels via a CSS variable; pointer, wheel,
  pinch and keyboard control; search highlight; reduced-motion respected; list view alternative.
* **Tree maps** reuse the layout with aggregated, k-anonymised families/genres/artists and no tracks.
