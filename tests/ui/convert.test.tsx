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

  it('explains that playlist links need sign-in and a configured service', async () => {
    mockApi((url) => {
      if (url.startsWith('/api/me')) return unauthenticated();
      if (url.startsWith('/api/providers')) return PROVIDERS;
      return {};
    });
    const user = userEvent.setup();
    renderWithProviders(<ConvertPage />, '/convert');
    await user.click(await screen.findByRole('tab', { name: 'Playlist link' }));
    expect(screen.getByLabelText('Playlist link')).toBeDisabled();
    expect(screen.getByText(/to convert a playlist link/)).toBeInTheDocument();
    expect(screen.getAllByText('Not set up on this server')).toHaveLength(3);
  });

  it('decodes UTF-16 playlist exports (Apple Music / iTunes) and Windows-1252 CSVs', async () => {
    const text = 'Name\tArtist\r\nCafé Song\tSí Señor\r\n';
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]);
    expect(await readTextFile(new Blob([utf16]))).toBe(text);
    const cp1252 = new Uint8Array([...Array.from('title,artist\r\nCaf').map((c) => c.charCodeAt(0)), 0xe9, ...Array.from(',X').map((c) => c.charCodeAt(0))]);
    expect(await readTextFile(new Blob([cp1252]))).toBe('title,artist\r\nCafé,X');
  });
});
