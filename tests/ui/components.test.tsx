// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMusicMap } from '../../src/shared/analysis/map';
import { computeProfile } from '../../src/shared/analysis/profile';
import { ApiError } from '../../src/client/api';
import { ErrorState, EmptyState } from '../../src/client/components/States';
import { MapList, MusicMap } from '../../src/client/components/MusicMap';
import { MatchBreakdown, ScoreRing } from '../../src/client/components/Charts';
import { compareVectors } from '../../src/shared/analysis/similarity';
import { buildMatchVector } from '../../src/shared/analysis/profile';
import { Landing } from '../../src/client/pages/Landing';
import { LibraryPage } from '../../src/client/pages/Library';
import { library, track } from '../helpers/library';
import { ME, mockApi, renderWithProviders, unauthenticated } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function sampleMap() {
  const tracks = [
    ...library('Neon', 6, ['Nova Lattice', 'Pulse Garden'], ['synthwave', 'techno']),
    ...library('Blue', 4, ['Teo Vance'], ['hard bop']),
    track('Unlabelled', 'Mira Sol', []),
  ];
  return buildMusicMap(tracks, computeProfile(tracks));
}

describe('Landing page', () => {
  it('states the product, both taglines and honest calls to action', async () => {
    mockApi(() => unauthenticated());
    renderWithProviders(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You Are What You Consume');
    expect(screen.getAllByText(/SOMM — Sound of My Mind/).length).toBeGreaterThan(0);
    expect(screen.getByText('Map your music. Discover your sound. Find your people.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A Social Mind for Audiophiles' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Map my music/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
    // SOMM is public: no demo account on the landing page.
    expect(screen.queryByRole('button', { name: /demo/i })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /fictional library/ })).toBeInTheDocument();
    expect(screen.getByText(/generated live from a fictional library/)).toBeInTheDocument();
    expect(screen.getByText(/never asks for your Spotify, YouTube or Apple password/)).toBeInTheDocument();
  });
});

describe('MusicMap', () => {
  it('exposes genre nodes as keyboard-focusable buttons with descriptive labels', async () => {
    const onSelect = vi.fn();
    render(<MusicMap map={sampleMap()} ariaLabel="Test map" onSelect={onSelect} />);
    const app = screen.getByRole('application', { name: /Test map/ });
    expect(app).toHaveAttribute('tabindex', '0');
    const electronic = screen.getByRole('button', { name: /Genre family: Electronic, 6 tracks/ });
    expect(screen.getByRole('button', { name: /Genre family: Genre unknown, 1 track.*uncertain/ })).toBeInTheDocument();
    electronic.focus();
    fireEvent.keyDown(electronic, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'family:electronic' }));
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit the whole map' })).toBeInTheDocument();
  });

  it('highlights search matches', () => {
    const { container } = render(<MusicMap map={sampleMap()} ariaLabel="Test map" query="hard bop" />);
    const match = container.querySelector('[data-id="genre:hard bop"]');
    expect(match).toHaveAttribute('data-match', 'true');
    expect(container.querySelector('[data-id="family:electronic"]')).toHaveAttribute('data-dim', 'true');
  });

  it('dims unrelated nodes when one is selected', () => {
    const { container } = render(<MusicMap map={sampleMap()} ariaLabel="Test map" selectedId="family:jazz" />);
    expect(container.querySelector('[data-id="family:jazz"]')).toHaveAttribute('data-selected', 'true');
    expect(container.querySelector('[data-id="family:electronic"]')).toHaveAttribute('data-dim', 'true');
  });

  it('offers an accessible list alternative with the same hierarchy', async () => {
    const onSelect = vi.fn();
    render(<MapList map={sampleMap()} onSelect={onSelect} />);
    const list = screen.getByRole('list', { name: 'Music Map as a list' });
    expect(within(list).getAllByText('Electronic').length).toBeGreaterThan(0);
    expect(within(list).getByText('Genre unknown')).toBeInTheDocument();
    expect(within(list).getAllByText('uncertain').length).toBeGreaterThan(0);
    await userEvent.click(within(list).getAllByRole('button', { name: 'details' })[0]!);
    expect(onSelect).toHaveBeenCalled();
    expect(screen.getByText('Sound attributes')).toBeInTheDocument();
    expect(screen.getAllByText('inferred').length).toBeGreaterThan(0);
  });
});

describe('States', () => {
  it('explains network failures and retries', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(0, 'network', 'Could not reach SOMM.')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('You appear to be offline');
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders empty states with a call to action', () => {
    render(<EmptyState title="Nothing here" action={<a href="/import">Import</a>}>Explain</EmptyState>);
    expect(screen.getByRole('region', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import' })).toBeInTheDocument();
  });
});

describe('Match transparency components', () => {
  it('shows each component, its contribution and the unused (renormalised) ones', () => {
    const a = library('A', 12, ['Nova Lattice', 'Pulse Garden', 'Kilo Ray'], ['techno']);
    const b = library('B', 12, ['Nova Lattice', 'Pulse Garden', 'Kilo Ray'], ['techno']);
    const match = compareVectors(buildMatchVector(a), buildMatchVector(b));
    render(
      <>
        <ScoreRing score={match.score} label={match.label} />
        <MatchBreakdown match={match} />
      </>,
    );
    expect(screen.getByRole('img', { name: new RegExp(`Match score ${Math.round(match.score * 100)} out of 100`) })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Score components' });
    expect(within(list).getByText('Shared artists')).toBeInTheDocument();
    expect(within(list).getByText('not used')).toBeInTheDocument();
    expect(screen.getByText('How this was calculated')).toBeInTheDocument();
  });
});

describe('Library page', () => {
  const longTitle = 'An Extremely Long Fictional Track Title That Keeps Going And Going '.repeat(4).trim();
  const page = {
    total: 2,
    page: 1,
    pageSize: 50,
    tracks: [
      {
        id: 't1', title: longTitle, version: null, artist: { id: 'a1', name: 'Nova Lattice' }, featured: [], album: null, year: 2019, durationMs: 252000,
        explicit: null, genres: [], providers: ['csv'], addedAt: '2026-10-13T00:00:00Z', enrichment: 'done', coverage: { genre: false, year: true, album: false, duration: true },
      },
      {
        id: 't2', title: 'Glass Orbit', version: 'remix', artist: { id: 'a1', name: 'Nova Lattice' }, featured: ['Ivy Marlowe'], album: { id: 'al', title: 'Neon Tides' }, year: 2020,
        durationMs: null, explicit: false, genres: [{ name: 'synthwave', label: 'Synthwave', family: 'electronic' }], providers: ['csv'], addedAt: '2026-10-13T00:00:00Z', enrichment: 'done',
        coverage: { genre: true, year: true, album: true, duration: false },
      },
    ],
  };
  const facets = { genres: [], families: [], artists: [], providers: [{ provider: 'csv', n: 2 }], coverage: { genre: 0.5, year: 1, album: 0.5, duration: 0.5 }, totals: { tracks: 2, artists: 1, albums: 1, genres: 1 }, unknownGenreCount: 1, enrichment: {} };

  it('renders long names safely, coverage indicators and version badges', async () => {
    mockApi((url) => {
      if (url.startsWith('/api/me')) return ME;
      if (url.startsWith('/api/library/tracks')) return page;
      if (url.startsWith('/api/library/facets')) return facets;
      if (url.startsWith('/api/playlists')) return { playlists: [] };
      return {};
    });
    renderWithProviders(<LibraryPage />, '/library');
    const long = await screen.findByTitle(longTitle);
    expect(long).toHaveClass('clamp-2');
    expect(screen.getByRole('img', { name: 'Missing: genre, album' })).toBeInTheDocument();
    expect(screen.getByText('remix')).toBeInTheDocument();
    expect(screen.getByText('genre unknown')).toBeInTheDocument();
    expect(screen.getByLabelText('Search songs, artists, albums or genres')).toBeInTheDocument();
  });

  it('recovers from a network failure with retry', async () => {
    let fail = true;
    mockApi((url) => {
      if (url.startsWith('/api/me')) return ME;
      if (url.startsWith('/api/library/tracks')) {
        if (fail) throw new TypeError('Failed to fetch');
        return page;
      }
      if (url.startsWith('/api/library/facets')) return facets;
      return { playlists: [] };
    });
    renderWithProviders(<LibraryPage />, '/library');
    expect(await screen.findByText('You appear to be offline')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByText('Glass Orbit')).toBeInTheDocument());
  });

  it('shows an empty state for a new library', async () => {
    mockApi((url) => {
      if (url.startsWith('/api/me')) return ME;
      if (url.startsWith('/api/library/tracks')) return { total: 0, page: 1, pageSize: 50, tracks: [] };
      if (url.startsWith('/api/library/facets')) return { ...facets, totals: { tracks: 0, artists: 0, albums: 0, genres: 0 } };
      return { playlists: [] };
    });
    renderWithProviders(<LibraryPage />, '/library');
    expect(await screen.findByRole('heading', { name: 'Your library is empty' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import a playlist' })).toHaveAttribute('href', '/import');
  });
});
