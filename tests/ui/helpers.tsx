import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { RouterProvider } from '../../src/client/router';
import { AuthProvider, ToastProvider } from '../../src/client/state';

export type Route = (url: string, init?: RequestInit) => unknown | Promise<unknown>;

/** Mock fetch with a function of (url) → JSON body | Response | thrown error. */
export function mockApi(handler: Route) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const result = await handler(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const unauthenticated = () => new Response(JSON.stringify({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } }), { status: 401 });

export const ME = {
  user: {
    id: 'u1',
    handle: 'tester',
    displayName: 'Test Listener',
    bio: '',
    isDemo: 0,
    profileVisibility: 'private',
    discoverable: false,
    showMemberships: false,
    onboarded: true,
    createdAt: '2026-10-13T00:00:00.000Z',
    expiresAt: null,
  },
  counts: { playlists: 1, tracks: 3, memberships: 0 },
  isAdmin: false,
};

export function renderWithProviders(ui: ReactElement, path = '/') {
  window.history.pushState(null, '', path);
  return render(
    <RouterProvider>
      <ToastProvider>
        <AuthProvider>{ui}</AuthProvider>
      </ToastProvider>
    </RouterProvider>,
  );
}
