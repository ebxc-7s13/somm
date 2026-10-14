// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConvertPage } from '../../src/client/pages/Convert';
import { readTextFile } from '../../src/client/fileText';
import { mockApi, renderWithProviders, unauthenticated } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const PROVIDERS = {
  providers: [
    { id: 'youtube', label: 'YouTube', state: 'needs_credentials', summary: '', limitations: [], verifiedAt: '2026-10-13' },
    { id: 'spotify', label: 'Spotify', state: 'needs_credentials', summary: '', limitations: [], verifiedAt: '2026-10-13' },
    { id: 'apple_music', label: 'Apple Music', state: 'needs_credentials', summary: '', limitations: [], verifiedAt: '2026-10-13' },
  ],
};

const row = (title: string, artist: string, genre = '') => ({ title, artist, album: '', genre, year: '', duration: '', isrc: '', bpm: '', instruments: '', mood: '', tags: '', link: '' });

describe('Playlist to CSV converter page', () => {
  it('converts a pasted list, lets the listener fix rows, downloads the CSV and hands the same CSV to import', async () => {
    const api = mockApi((url, init) => {
      if (url.startsWith('/api/me')) return unauthenticated();
      if (url.startsWith('/api/providers')) return PROVIDERS;
      if (url.startsWith('/api/convert')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ source: 'text', name: 'Road trip' });
        return {
          stored: false,
          playlists: [{ name: 'Road trip', provider: 'text', rows: [row('Glass Orbit', 'Nova Lattice'), row('Blue Hour', '')], errors: [{ row: 3, message: 'Could not read this line.' }], notes: [] }],
        };
      }
      return {};
    });
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (blobs.push(b as Blob), 'blob:somm-test'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();

    renderWithProviders(<ConvertPage />, '/convert');
    expect(await screen.findByRole('heading', { name: 'Convert a playlist to CSV' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/one per line/), 'Nova Lattice - Glass Orbit');
    await user.type(screen.getByLabelText('Playlist name'), 'Road trip');
    await user.click(screen.getByRole('button', { name: 'Convert' }));

    expect(await screen.findByRole('heading', { name: 'Your playlist as a CSV' })).toBeInTheDocument();
    // The incomplete row is flagged, not silently dropped.
    expect(screen.getByLabelText('Artist, song 2')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('1 item in the source could not be read')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Genre, song 1'), 'synthwave');
    await user.click(screen.getByRole('button', { name: /Download CSV/ }));
    expect(clicked).toHaveBeenCalled();
    const csv = await readTextFile(blobs[0]!);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('title,artist,album,genre,year,duration,isrc,bpm,instruments,mood,tags,link');
    expect(lines.slice(1)).toEqual(['Glass Orbit,Nova Lattice,,synthwave,,,,,,,,']);

    await user.click(screen.getByRole('button', { name: 'Sign in and import this CSV' }));
    await waitFor(() => expect(window.location.pathname).toBe('/signin'));
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/import?from=convert');
    const handoff = JSON.parse(sessionStorage.getItem('somm:converted-csv')!);
    // Same bytes as the download (the decoder above drops the byte-order mark).
    expect(handoff.csv).toBe(String.fromCharCode(0xfeff) + csv);
    expect(handoff.fileName).toBe('road-trip-somm.csv');
    expect(api).toHaveBeenCalled();
  });

  it('explains what each playlist link needs and points to pasting instead', async () => {
    mockApi((url) => {
      if (url.startsWith('/api/me')) return unauthenticated();
      if (url.startsWith('/api/providers')) return PROVIDERS;
      return {};
    });
    const user = userEvent.setup();
    renderWithProviders(<ConvertPage />, '/convert');
    await user.click(await screen.findByRole('tab', { name: 'Playlist link' }));
    expect(screen.getByLabelText('Playlist link')).toBeDisabled();
    expect(screen.getAllByText('Not set up on this server')).toHaveLength(3);
    expect(screen.getByText(/free YouTube Data API key/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Spotify/ }));
    expect(screen.getByText(/press Ctrl\+A then Ctrl\+C/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to “Paste a list”' }));
    expect(screen.getByLabelText(/one per line/)).toBeInTheDocument();
  });

  it('finds song details a few songs at a time, filling only empty cells and marking each row', async () => {
    const matchBodies: any[] = [];
    mockApi((url, init) => {
      if (url.startsWith('/api/me')) return unauthenticated();
      if (url.startsWith('/api/providers')) return { ...PROVIDERS, enrichment: { enabled: true, reason: null } };
      if (url.startsWith('/api/convert/match')) {
        matchBodies.push(JSON.parse(String(init?.body)));
        return {
          results: [
            { status: 'check', fill: { artist: 'Teo Vance', album: 'Engines', year: '1964', genre: 'hard bop' }, url: 'https://musicbrainz.org/recording/r1', message: 'Artist guessed — please check.' },
            { status: 'matched', fill: { album: 'Signals', year: '2019', genre: 'synthwave' }, url: 'https://musicbrainz.org/recording/r2', message: 'Matched in MusicBrainz.' },
          ],
        };
      }
      if (url.startsWith('/api/convert')) {
        return { stored: false, playlists: [{ name: 'Mixed', provider: 'text', rows: [row('Quiet Engine', ''), row('Glass Orbit', 'Nova Lattice', 'my genre')], errors: [], notes: [] }] };
      }
      return {};
    });
    const user = userEvent.setup();
    renderWithProviders(<ConvertPage />, '/convert');
    await user.type(await screen.findByLabelText(/one per line/), 'Quiet Engine');
    await user.click(screen.getByRole('button', { name: 'Convert' }));
    await user.click(await screen.findByRole('button', { name: 'Find details for 2 songs' }));

    expect(await screen.findByText('✓ Matched')).toBeInTheDocument();
    expect(screen.getByText('Check')).toBeInTheDocument();
    expect(matchBodies).toHaveLength(1);
    expect(matchBodies[0].rows.map((r: any) => r.title)).toEqual(['Quiet Engine', 'Glass Orbit']);
    expect(screen.getByLabelText('Artist, song 1')).toHaveValue('Teo Vance');
    expect(screen.getByLabelText('Album, song 2')).toHaveValue('Signals');
    // The listener's own genre is kept.
    expect(screen.getByLabelText('Genre, song 2')).toHaveValue('my genre');
    expect(screen.getByRole('button', { name: 'All songs have details' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Matched: open in MusicBrainz/ })).toHaveAttribute('href', 'https://musicbrainz.org/recording/r2');
  });

  it('decodes UTF-16 playlist exports (Apple Music / iTunes) and Windows-1252 CSVs', async () => {
    const text = 'Name\tArtist\r\nCafé Song\tSí Señor\r\n';
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]);
    expect(await readTextFile(new Blob([utf16]))).toBe(text);
    const cp1252 = new Uint8Array([...Array.from('title,artist\r\nCaf').map((c) => c.charCodeAt(0)), 0xe9, ...Array.from(',X').map((c) => c.charCodeAt(0))]);
    expect(await readTextFile(new Blob([cp1252]))).toBe('title,artist\r\nCafé,X');
  });
});
