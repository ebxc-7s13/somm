/**
 * Enrichment pipeline with a mocked MusicBrainz web service (fictional data).
 */
import { describe, expect, it } from 'vitest';
import { MusicBrainzClient, pickRecording, userAgentFor, weightGenres } from '../../src/server/enrich/musicbrainz';
import { createTestServer, csv } from '../helpers/server';
import { json, mockFetch, noSleep } from '../helpers/mockfetch';

const MBID = '0f6c2b8e-0000-4000-8000-000000000001';

function mbRoutes(opts: { searchHits?: boolean; fail503?: boolean } = {}) {
  return mockFetch([
    {
      match: /\/ws\/2\/isrc\//,
      respond: () => json({ recordings: [{ id: MBID, title: 'Glass Orbit', length: 252000, 'artist-credit': [{ name: 'Nova Lattice', artist: { id: 'mb-artist-1', name: 'Nova Lattice' } }] }] }),
    },
    {
      match: /\/ws\/2\/recording\?query=/,
      respond: () =>
        opts.fail503
          ? json({}, 503)
          : json({
              recordings: opts.searchHits === false
                ? []
                : [
                    { id: 'mb-wrong', score: 100, title: 'Quiet Engine', length: 900000, 'artist-credit': [{ name: 'Teo Vance', artist: { id: 'mb-artist-2', name: 'Teo Vance' } }] },
                    { id: 'mb-rec-2', score: 98, title: 'Quiet Engine', length: 375000, 'artist-credit': [{ name: 'Teo Vance', artist: { id: 'mb-artist-2', name: 'Teo Vance' } }] },
                  ],
            }),
    },
    {
      match: new RegExp(`/ws/2/recording/${MBID}`),
      respond: () =>
        json({
          id: MBID,
          title: 'Glass Orbit',
          length: 252000,
          'first-release-date': '2019-04-01',
          'artist-credit': [{ name: 'Nova Lattice', artist: { id: 'mb-artist-1', name: 'Nova Lattice' } }],
          genres: [{ name: 'synthwave', count: 4 }, { name: 'electronic', count: 2 }, { name: 'pop', count: 1 }],
          tags: [{ name: 'synthwave', count: 4 }, { name: 'atmospheric', count: 3 }, { name: 'seen live', count: 9 }, { name: 'night driving', count: 2 }],
          isrcs: ['QZFAK1900001'],
          relations: [{ type: 'instrument', 'target-type': 'artist', attributes: ['synthesizer'], artist: { id: 'p1', name: 'Rhea Okafor' } }],
        }),
    },
    {
      match: /\/ws\/2\/recording\/mb-rec-2/,
      respond: () =>
        json({ id: 'mb-rec-2', title: 'Quiet Engine', length: 375000, 'first-release-date': '1964', 'artist-credit': [{ name: 'Teo Vance', artist: { id: 'mb-artist-2', name: 'Teo Vance' } }], genres: [], tags: [], relations: [] }),
    },
    { match: /\/ws\/2\/artist\/mb-artist-2/, respond: () => json({ genres: [{ name: 'hard bop', count: 3 }] }) },
  ]);
}

describe('MusicBrainz client', () => {
  it('sends the required contact User-Agent', async () => {
    const { fetchImpl, calls } = mbRoutes();
    await new MusicBrainzClient('maintainer@example.invalid', fetchImpl, { intervalMs: 0, sleep: noSleep }).lookupIsrc('QZFAK1900001');
    expect((calls[0]?.init?.headers as Record<string, string>)['User-Agent']).toBe(userAgentFor('maintainer@example.invalid'));
    expect(calls[0]?.url).toContain('fmt=json');
  });

  it('picks the matching recording and rejects conflicting lengths', () => {
    const results = [
      { id: 'a', score: 100, title: 'Quiet Engine', length: 900000, 'artist-credit': [{ name: 'Teo Vance', artist: { id: '1', name: 'Teo Vance' } }] },
      { id: 'b', score: 95, title: 'Quiet Engine', length: 375000, 'artist-credit': [{ name: 'Teo Vance', artist: { id: '1', name: 'Teo Vance' } }] },
      { id: 'c', score: 99, title: 'Quiet Engine', length: 375000, 'artist-credit': [{ name: 'Someone Else', artist: { id: '2', name: 'Someone Else' } }] },
    ];
    expect(pickRecording(results, 'Quiet Engine', 'Teo Vance', 375000)?.id).toBe('b');
    expect(pickRecording(results, 'Quiet Engine', 'Nobody', null)).toBeNull();
  });

  it('weights genre votes and drops weakly supported genres', () => {
    expect(weightGenres([{ name: 'synthwave', count: 4 }, { name: 'electronic', count: 2 }, { name: 'pop', count: 1 }])).toEqual([
      { name: 'synthwave', confidence: 0.9 },
      { name: 'electronic', confidence: 0.73 },
    ]);
    expect(weightGenres([])).toEqual([]);
  });
});

describe('enrichment queue', () => {
  it('stores genres, credits and tags with provenance and updates the profile', async () => {
    const { fetchImpl } = mbRoutes();
    const musicbrainz = new MusicBrainzClient('maintainer@example.invalid', fetchImpl, { intervalMs: 0, sleep: noSleep });
    const { client, ctx } = createTestServer({ musicbrainz });
    const a = client();
    await a.signup('enricher');
    const content = 'title,artist,isrc,duration\nGlass Orbit,Nova Lattice,QZFAK1900001,4:12\nQuiet Engine,Teo Vance,,6:15';
    const { jobId } = await a.importCsv(content);
    await ctx.queue.drain();

    const job = (await a.get(`/api/imports/jobs/${jobId}`)).body.job;
    expect(job.status).toBe('done');
    expect(job.counts).toMatchObject({ done: 2, pending: 0 });
    expect(job.genreCoverage).toBe(1);

    const lib = (await a.get('/api/library/tracks?sort=title')).body.tracks;
    const glass = lib.find((t: any) => t.title === 'Glass Orbit');
    const detail = (await a.get(`/api/library/tracks/${glass.id}`)).body;
    expect(detail.genres.map((g: any) => [g.name, g.source, g.kind])).toEqual(
      expect.arrayContaining([
        ['synthwave', 'musicbrainz', 'community'],
        ['electronic', 'musicbrainz', 'community'],
      ]),
    );
    expect(detail.genres.find((g: any) => g.name === 'pop')).toBeUndefined();
    expect(detail.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'instrument', value: 'synthesizer', kind: 'credited' }),
        expect.objectContaining({ category: 'texture', value: 'atmospheric', kind: 'community' }),
      ]),
    );
    expect(detail.track.releaseYear).toBe(2019);
    expect(detail.links.map((l: any) => l.namespace)).toContain('musicbrainz:recording');

    // Artist-level genres are used (with lower confidence) when the recording has none.
    const quiet = lib.find((t: any) => t.title === 'Quiet Engine');
    const qd = (await a.get(`/api/library/tracks/${quiet.id}`)).body;
    expect(qd.genres[0]).toMatchObject({ name: 'hard bop', source: 'musicbrainz:artist' });
    expect(qd.genres[0].confidence).toBeLessThan(0.9);

    const profile = (await a.get('/api/profile')).body;
    expect(profile.profile.coverage.genre).toBe(1);
    expect(profile.pendingEnrichment).toBe(0);
    // Junk tags are discarded; unmapped descriptive tags are kept for the optional text component.
    const tags = ctx.db.prepare('SELECT tag FROM track_tags').all() as { tag: string }[];
    expect(tags.map((t) => t.tag)).toEqual(['night driving']);
  });

  it('caches lookups so the same song is not fetched twice', async () => {
    const { fetchImpl, calls } = mbRoutes();
    const musicbrainz = new MusicBrainzClient('maintainer@example.invalid', fetchImpl, { intervalMs: 0, sleep: noSleep });
    const { client, ctx } = createTestServer({ musicbrainz });
    const a = client();
    await a.signup('cache-a');
    await a.importCsv('title,artist,isrc\nGlass Orbit,Nova Lattice,QZFAK1900001');
    await ctx.queue.drain();
    const before = calls.length;
    const b = client();
    await b.signup('cache-b');
    await b.importCsv('title,artist,isrc\nGlass Orbit,Nova Lattice,QZFAK1900001');
    await ctx.queue.drain();
    expect(calls.length).toBe(before);
  });

  it('marks unmatched songs as not found instead of guessing', async () => {
    const { fetchImpl } = mbRoutes({ searchHits: false });
    const musicbrainz = new MusicBrainzClient('maintainer@example.invalid', fetchImpl, { intervalMs: 0, sleep: noSleep });
    const { client, ctx } = createTestServer({ musicbrainz });
    const a = client();
    await a.signup('unmatched');
    const { jobId } = await a.importCsv(csv([['Imaginary Song', 'Nobody Real']]));
    await ctx.queue.drain();
    const job = (await a.get(`/api/imports/jobs/${jobId}`)).body.job;
    expect(job.counts.notFound).toBe(1);
    expect(job.genreCoverage).toBe(0);
    const profile = (await a.get('/api/profile')).body.profile;
    expect(profile.unknownGenreCount).toBe(1);
  });

  it('records provider failures as partial results and supports retry', async () => {
    const failing = mbRoutes({ fail503: true });
    const musicbrainz = new MusicBrainzClient('maintainer@example.invalid', failing.fetchImpl, { intervalMs: 0, sleep: noSleep });
    const { client, ctx } = createTestServer({ musicbrainz });
    const a = client();
    await a.signup('flaky');
    const { jobId } = await a.importCsv(csv([['Imaginary Song', 'Nobody Real']]));
    await ctx.queue.drain();
    let job = (await a.get(`/api/imports/jobs/${jobId}`)).body.job;
    expect(job.status).toBe('partial');
    expect(job.counts.error).toBe(1);
    expect(job.enrichmentErrors[0].message).toMatch(/temporarily unavailable/);
    const retry = await a.post(`/api/imports/jobs/${jobId}/retry`);
    expect(retry.body.requeued).toBe(1);
    job = (await a.get(`/api/imports/jobs/${jobId}`)).body.job;
    expect(job.status).toBe('enriching');
  });
});
