// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyTree, TreeSummary } from '../../src/client/types';
import { ME, mockApi, renderWithProviders } from './helpers';

vi.mock('../../src/client/realtime', () => ({
  realtime: () => ({ status: 'closed', connect: () => {}, disconnect: () => {}, on: () => () => {} }),
}));

const { TreesPage } = await import('../../src/client/pages/Trees');
const { Shell } = await import('../../src/client/components/Shell');
const { resetClientConfig } = await import('../../src/client/clientConfig');

afterEach(() => {
  vi.unstubAllGlobals();
  resetClientConfig();
});

const summary = (slug: string, name: string, isMember: boolean): TreeSummary => ({
  id: `id-${slug}`, slug, name, description: '', status: 'active', origin: 'member', color: '#4D7CFF', glyphSeed: slug,
  memberCount: 4, isDemo: false, families: [], topGenres: [], isMember, createdAt: '2026-10-13T00:00:00Z',
});

const joined: MyTree = {
  ...summary('neon-garden', 'Neon Garden', true),
  unread: 2,
  lastMessage: { id: 9, author: 'Other Listener', excerpt: 'New mix is up', createdAt: new Date().toISOString(), mine: false },
};

describe('Trees page', () => {
  it('lists Trees you joined separately from "Explore similar Trees", with unread counts', async () => {
    mockApi((url) => {
      if (url === '/api/me') return ME;
      if (url.startsWith('/api/me/trees')) return { trees: [joined], totalUnread: 2 };
      if (url.startsWith('/api/trees/recommended')) return { recommendations: [{ community: joined, match: {}, explanation: { summary: '', points: [] }, isMember: true }] };
      if (url.startsWith('/api/trees/eligibility')) return { eligible: false, compatibleCount: 0, needed: 2, threshold: 0.3, reason: 'Not enough listeners yet.' };
      if (url.startsWith('/api/discover/listeners')) return { listeners: [], requiresDiscoverable: true };
      if (url.startsWith('/api/trees')) return { trees: [summary('neon-garden', 'Neon Garden', true), summary('quiet-jazz', 'Quiet Jazz', false)] };
      return {};
    });
    renderWithProviders(<TreesPage />, '/trees');

    const yours = (await screen.findByRole('heading', { name: 'Your Trees' })).closest('section')!;
    expect(within(yours).getByText('Neon Garden')).toBeInTheDocument();
    expect(within(yours).getByText(/Other Listener: New mix is up/)).toBeInTheDocument();
    expect(within(yours).getByRole('link', { name: 'Open Neon Garden chat, 2 new' })).toHaveAttribute('href', '/trees/neon-garden/chat');

    const explore = screen.getByRole('heading', { name: 'Explore similar Trees' }).closest('section')!;
    expect(await within(explore).findByText('No new Trees to suggest yet')).toBeInTheDocument();
    expect(within(explore).queryByText('Neon Garden')).not.toBeInTheDocument();

    const more = screen.getByRole('heading', { name: 'More Trees' }).closest('section')!;
    expect(await within(more).findByText('Quiet Jazz')).toBeInTheDocument();
    expect(within(more).queryByText('Neon Garden')).not.toBeInTheDocument();
  });
});

describe('App shell', () => {
  it('opens an account menu that closes with Escape and on navigation', async () => {
    mockApi((url) => {
      if (url === '/api/me') return ME;
      if (url.startsWith('/api/client-config')) return { realtime: 'poll', calls: false, compressAboveBytes: 1048576, maxRequestBytes: 4194304 };
      return {};
    });
    renderWithProviders(
      <Shell>
        <p>Page</p>
      </Shell>,
      '/map',
    );
    const button = await screen.findByRole('button', { name: /@tester/ });
    await userEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Account' });
    // Rendered into <body>, above the page, with every account destination.
    expect(menu.parentElement).toBe(document.body);
    expect(within(menu).getByText('Test Listener')).toBeInTheDocument();
    for (const name of ['My public profile', 'Playlist to CSV converter', 'Notifications & settings', 'Privacy & sharing', 'Account & data', 'Sign out']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Privacy & sharing' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/settings/privacy');
  });
});
