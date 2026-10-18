/**
 * Always-on hosting on free plans: the server keeps its free Render service awake,
 * and stays quiet towards the database while idle so Neon can scale to zero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '../../src/server/db';
import { EnrichmentQueue } from '../../src/server/enrich/queue';
import { KEEP_AWAKE_INTERVAL_MS, keepAwakeUrl, startKeepAwake } from '../../src/server/keepawake';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('keep-awake', () => {
  it('is on for an https Render URL, can be turned off, and ignores anything else', () => {
    expect(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'https://soundofmymind.onrender.com/' })).toBe('https://soundofmymind.onrender.com');
    expect(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'https://soundofmymind.onrender.com', KEEP_AWAKE: 'false' })).toBeNull();
    expect(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'https://a.onrender.com', KEEP_AWAKE_URL: 'https://somm.example.org/x' })).toBe('https://somm.example.org');
    expect(keepAwakeUrl({})).toBeNull();
    expect(keepAwakeUrl({ KEEP_AWAKE_URL: 'http://insecure.example.org' })).toBeNull();
    expect(keepAwakeUrl({ KEEP_AWAKE_URL: 'not a url' })).toBeNull();
  });

  it('pings the health endpoint well inside the 15-minute idle limit, and logs failures once', async () => {
    vi.useFakeTimers();
    expect(KEEP_AWAKE_INTERVAL_MS).toBeLessThan(15 * 60 * 1000);
    const calls: string[] = [];
    let fail = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (fail) throw new Error('network down');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const stop = startKeepAwake('https://somm.example.org', { fetchImpl, log: (m) => logs.push(m) });

    await vi.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS * 3);
    expect(calls).toEqual(Array(3).fill('https://somm.example.org/api/health'));

    fail = true;
    await vi.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS * 2);
    expect(logs).toEqual(['[somm] keep-awake ping failed: network down']);
    fail = false;
    await vi.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS);
    expect(logs.at(-1)).toBe('[somm] keep-awake ping is working again');

    stop();
    await vi.advanceTimersByTimeAsync(KEEP_AWAKE_INTERVAL_MS * 5);
    expect(calls).toHaveLength(6);
  });
});

describe('idle enrichment worker', () => {
  function worker() {
    const queue = new EnrichmentQueue({} as DB, { musicbrainz: null, itunes: null, disabledReason: null, onUsersChanged: async () => undefined });
    vi.spyOn(queue, 'flush').mockResolvedValue(undefined);
    return queue;
  }

  it('does not poll the database while nothing is pending, and wakes when an import kicks it', async () => {
    vi.useFakeTimers();
    const queue = worker();
    const next = vi.spyOn(queue, 'processNext').mockResolvedValue(false);
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledTimes(1);

    // An hour of idling: no checks at all (the old worker checked every 5 seconds).
    await vi.advanceTimersByTimeAsync(3600 * 1000);
    expect(next).toHaveBeenCalledTimes(1);

    queue.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledTimes(2);

    // A rare safety check catches tracks queued without a kick.
    await vi.advanceTimersByTimeAsync(6 * 3600 * 1000);
    expect(next).toHaveBeenCalledTimes(3);
    const stopped = queue.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopped;
  });

  it('retries soon after an error, such as the database waking up', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = worker();
    const next = vi.spyOn(queue, 'processNext').mockRejectedValueOnce(new Error('connection terminated')).mockResolvedValue(false);
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(next).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3600 * 1000);
    expect(next).toHaveBeenCalledTimes(2);
    const stopped = queue.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopped;
  });
});
