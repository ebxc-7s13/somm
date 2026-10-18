// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TreeSummary } from '../../src/client/types';
import { ME, mockApi, renderWithProviders } from './helpers';

// Replace the WebSocket client with an inert fake.
const handlers = new Map<string, (m: any) => void>();
vi.mock('../../src/client/realtime', () => ({
  realtime: () => ({
    status: 'open',
    connect: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    send: () => true,
    on: (type: string, fn: (m: any) => void) => {
      handlers.set(type, fn);
      return () => handlers.delete(type);
    },
  }),
}));

const { TreeChat } = await import('../../src/client/pages/TreeChat');
const { resetClientConfig } = await import('../../src/client/clientConfig');

const tree: TreeSummary = {
  id: 'tree1', slug: 'neon-garden', name: 'Neon Garden', description: '', status: 'active', origin: 'member', color: '#4D7CFF', glyphSeed: 'x',
  memberCount: 3, isDemo: false, families: [], topGenres: [], isMember: true, createdAt: '2026-10-13T00:00:00Z',
};

const msg = (id: number, body: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, communityId: 'tree1', author: { id: 'u2', handle: 'other', displayName: 'Other Listener', isDemo: false }, body, hidden: false, replyTo: null,
  ref: null, link: null, createdAt: '2026-10-13T10:00:00Z', mine: false, ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  handlers.clear();
  resetClientConfig();
});

describe('Tree chat UI', () => {
  it('polls for new messages on hosts without WebSocket push (Vercel)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen: string[] = [];
    mockApi((url) => {
      seen.push(url);
      if (url.startsWith('/api/me')) return ME;
      if (url.startsWith('/api/client-config')) return { realtime: 'poll', calls: false, compressAboveBytes: 1048576, maxRequestBytes: 4194304 };
      if (url.includes('after=1')) return { messages: [msg(2, 'arrived by polling')], hasMore: false };
      return { messages: [msg(1, 'first message')], hasMore: false };
    });
    renderWithProviders(<TreeChat tree={tree} isModerator={false} />);
    expect(await screen.findByText('Updates every few seconds')).toBeInTheDocument();
    expect(await screen.findByText('first message')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(4100);
    expect(await screen.findByText('arrived by polling')).toBeInTheDocument();
    expect(seen.some((u) => u.includes('/messages?after=1'))).toBe(true);
    // No socket handlers are registered in polling mode.
    expect(handlers.size).toBe(0);
  });

  it('renders untrusted message bodies as text and links safely', async () => {
    mockApi((url) => {
      if (url.startsWith('/api/me')) return ME;
      return {
        messages: [
          msg(1, '<img src=x onerror="alert(1)"> hello'),
          msg(2, 'listen https://open.spotify.com/track/abc', { link: { url: 'https://open.spotify.com/track/abc', provider: 'Spotify' } }),
          msg(3, 'gone', { hidden: true, body: null }),
        ],
        hasMore: false,
      };
    });
    const { container } = renderWithProviders(<TreeChat tree={tree} isModerator={false} />);
    expect(await screen.findByText('<img src=x onerror="alert(1)"> hello')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: /Open in Spotify/ });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('This message was hidden pending review.')).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByText('Live')).toHaveAttribute('data-status', 'open');
  });

  it('enforces the length limit and shows realtime messages', async () => {
    mockApi((url) => (url.startsWith('/api/me') ? ME : { messages: [], hasMore: false }));
    renderWithProviders(<TreeChat tree={tree} isModerator={false} />);
    const box = await screen.findByLabelText('Message Neon Garden');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.click(box);
    await userEvent.paste('x'.repeat(1001));
    expect(screen.getByText('1001/1000')).toHaveClass('error-text');
    expect(send).toBeDisabled();
    handlers.get('message')?.({ treeId: 'tree1', message: msg(9, 'pushed over the socket') });
    expect(await screen.findByText('pushed over the socket')).toBeInTheDocument();
  });

  it('keeps the draft and explains when sending fails offline', async () => {
    mockApi((url, init) => {
      if (url.startsWith('/api/me')) return ME;
      if (init?.method === 'POST') throw new TypeError('Failed to fetch');
      return { messages: [], hasMore: false };
    });
    renderWithProviders(<TreeChat tree={tree} isModerator={false} />);
    const box = await screen.findByLabelText('Message Neon Garden');
    await userEvent.type(box, 'hello there');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/offline/));
    expect(box).toHaveValue('hello there');
  });
});
