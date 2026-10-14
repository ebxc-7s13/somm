# Matching algorithm

Implementation: `src/shared/analysis/similarity.ts` (scores), `communities.ts` (aggregation, clustering,
labels, explanations), `src/server/services/communities.ts` (population statistics, Trees).

## Vectors

`buildMatchVector(tracks)` creates sparse vectors designed to avoid double counting:

| Component | Keys | Weights | Why |
| --- | --- | --- | --- |
| tracks | canonical track IDs | 1 (binary) | a song counts once however many playlists contain it |
| artists | artist IDs | 1 + ln(n) (featured credits count ½) | one prolific artist cannot dominate |
| genres | genre keys + `family:*` | per-track distribution (each track contributes 1, split by confidence) + ½ to families | broad similarity without per-track inflation |
| attributes | `category:value` | confidence; **verified only** (not inferred, confidence ≥ 0.5) | inferred attributes would re-count genres |
| text | tag tokens | 1 + ln(tf); only tags that are neither genres nor mapped attributes | non-overlapping with other components |

## Score

```
component_i = cosine_IDF(a_i, b_i) × evidence_i
evidence_i  = s / (s + k_i)          s = number of shared items, k = {tracks 1.5, artists 2, genres 3*, attributes 2, text 3}
Music Match = Σ w_i · component_i / Σ w_i      (over components that can be computed)
```
\* for genres, `s` is the smaller number of tracks with genre data on either side.

Default weights (hypotheses, **not** established truths): **tracks 0.40 · artists 0.25 · genres 0.20 ·
attributes 0.15 · text 0**. Override with `MATCH_WEIGHTS` (JSON). Every response exposes, per component: raw
similarity, evidence factor, final score, configured weight, effective (renormalised) weight, contribution,
number of shared items and a reason when unavailable.

### Safeguards

* **IDF:** `idf = max(0.15, (ln((N+1)/(df+1)) + 1) / (ln(N+1) + 1))` from the shared-scope inverted indexes
  (`profile_tracks/artists/genres`), counted only for the keys being compared. A song everyone has carries little weight.
* **Evidence factor:** a single shared song or artist cannot create a high score.
* **Cosine normalisation:** a 1,000-track library containing someone’s 10 songs scores lower than an equal
  10-song library (tested), and scores are symmetric.
* **Renormalisation:** attributes need ≥ 3 tracks with verified attributes on both sides; otherwise the
  component is marked unavailable and its weight is redistributed instead of counting as zero.
* **Labels with an evidence gate:** strong ≥ 0.55, good ≥ 0.35, possible ≥ 0.20, else weak. *Strong* additionally
  needs ≥ 3 shared tracks or ≥ 3 shared artists; *good* needs ≥ 2 shared artists or tracks, or genre score ≥ 0.6 plus
  one shared item. Downgrades are reported (`gate`).

### Tested scenarios (`tests/unit/similarity.test.ts`)

| Scenario | Expected and verified |
| --- | --- |
| Identical 25-track lists | > 0.85, strong |
| Same 5 artists, no shared tracks | 0.35–0.75, good/strong, track component 0 |
| Both 100 % pop, different artists | genre cosine > 0.95 but total < 0.3 (possible/weak) |
| Metal vs jazz with 2 shared artists | < 0.3, not good/strong |
| 10 tracks vs the same 10 inside 1,000 | lower than equal libraries; symmetric |
| No verified attributes | weights renormalised, reason shown |
| One popular song in common (with population IDF) | < 0.15, weak; two one-song libraries stay ≤ possible |
| Contributions | sum to the total score |

## Users and Trees

* A Tree’s vector is the **average of its members’ shared vectors**: each key holds the fraction of members who
  have it (distributions are averaged after normalisation). Private playlists never contribute.
* Recommendations compare the user’s full (`all`) vector — private data is only ever used for the user’s own
  view — with each active Tree (and proposed Trees the user is a candidate for).
* **Members are compared with everyone else in the Tree**, excluding their own contribution (otherwise joining
  would inflate one’s own score; regression-tested).
* **Explanations** are templates over the computed components (“You are a good match for X because your
  libraries share several artists, your genre distributions are similar…”). Artist names are included only if the
  artist is already in the Tree’s public, k-anonymised list; track names are never named for Trees.

### Worked example (demo data, 2026-10-13)

Sample library vs *Synthwave Sound Explorers* (3 fictional members):

| Component | Score | Weight | Contribution |
| --- | --- | --- | --- |
| Shared tracks (19) | 0.33 | 0.40 | 13.0 |
| Shared artists (9) | 0.52 | 0.25 | 13.0 |
| Genre distribution | 0.78 | 0.20 | 15.5 |
| Verified attributes (synthesizer, drum machine) | 0.41 | 0.15 | 6.1 |
| **Total** | | | **≈ 48 → “good match”** |

## Tree formation

* **Proposals** (`generateProposals`, `npm run trees:generate`, also used by the demo seed): discoverable
  listeners with shared playlists, excluding those already scoring ≥ 0.35 with an existing Tree, are clustered by
  **average-linkage agglomerative clustering** with merge threshold **0.30** and **minimum size 3**. A cluster
  scoring ≥ 0.6 against an existing Tree extends that Tree’s candidates instead of creating a near-duplicate.
  New Trees start as **proposed** (visible only to their candidate listeners) and become **active** (public)
  when two people actually join. Cost is O(n²) similarity evaluations — fine for a periodic batch over a few
  thousand discoverable profiles; beyond that, block candidates by dominant family first.
* **Labels** come from the cluster’s data: dominant family + a family noun (“Sound Explorers”, “Atmosphere”,
  “Improvisation Circle”, “Heavy Riffs”, “Raga Explorers”…), a leading genre or a second family; no family ≥ 35 %
  across ≥ 3 families → “Cross-Genre Discoverers”. The demo seed yields: Synthwave Sound Explorers, Dark Ambient
  Atmosphere, Cool Jazz Improvisation Circle, Americana Campfire, Black Metal Heavy Riffs, Jazz Rap Cypher,
  Indian Classical Raga Explorers (the eclectic listener correctly stays unclustered).
* **Member-created Trees** require ≥ 2 other discoverable listeners with a score ≥ 0.30 to the creator.
* **Names** can be proposed and voted on; a proposal with ≥ 2 votes from a majority of members renames the Tree.
* **Empty Trees:** a member-created Tree is archived when its last member leaves; a cluster Tree returns to proposed.

## Validation plan

The weights and thresholds are starting hypotheses. To validate them with consented, real usage:
1. log (aggregated, no content) recommendation impressions, joins, 30-day retention in a Tree and chat
   participation per score band;
2. fit a logistic model of “joined and stayed” on the component scores to re-estimate weights;
3. check calibration per label band and adjust thresholds;
4. A/B the optional text component before giving it weight.
