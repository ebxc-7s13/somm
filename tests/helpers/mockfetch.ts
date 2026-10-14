import type { FetchLike } from '../../src/server/http';

export interface MockRoute {
  match: RegExp;
  respond: (url: string, init: RequestInit | undefined, call: number) => Response | Promise<Response>;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** Deterministic fetch mock. Unmatched URLs throw, so tests never reach the network. */
export function mockFetch(routes: MockRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const perRoute = new Map<MockRoute, number>();
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const route = routes.find((r) => r.match.test(url));
    if (!route) throw new Error(`Unexpected request in test: ${url}`);
    const n = (perRoute.get(route) ?? 0) + 1;
    perRoute.set(route, n);
    return route.respond(url, init, n);
  };
  return { fetchImpl, calls };
}

export const noSleep = async () => {};
