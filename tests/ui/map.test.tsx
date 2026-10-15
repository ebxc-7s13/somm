// @vitest-environment jsdom
/**
 * The Music Map page: 3D / 2D / list views, the explore controls, full screen,
 * the text-size slider and the "Save my map" poster dialog. Also the
 * external-export (TuneMyMusic) guidance shown on the import pages.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMusicMap } from '../../src/shared/analysis/map';
import { computeProfile } from '../../src/shared/analysis/profile';
import { ExternalExportCallout, TUNEMYMUSIC_URL } from '../../src/client/components/ExternalExport';
import { MapPage } from '../../src/client/pages/MapPage';
import { library, track } from '../helpers/library';
import { ME, mockApi, renderWithProviders } from './helpers';

const tracks = [...library('Neon', 6, ['Nova Lattice', 'Pulse Garden'], ['synthwave', 'techno']), ...library('Blue', 4, ['Teo Vance'], ['hard bop']), track('Unlabelled', 'Mira Sol', [])];
const profile = computeProfile(tracks);
const map = buildMusicMap(tracks, profile);

function mapApi() {
  return mockApi((url) => {
    if (url.startsWith('/api/me')) return ME;
    if (url.startsWith('/api/profile/map')) return { map };
    if (url.startsWith('/api/profile')) return { profile, insights: [], computedAt: null, inputHash: null, sharedTrackCount: 0, pendingEnrichment: 0 };
    if (url.startsWith('/api/library/tracks')) return { tracks: [], total: 0, page: 1, pageSize: 25 };
    return {};
  });
}

async function openMap() {
  mapApi();
  renderWithProviders(<MapPage />, '/map');
  return screen.findByRole('application', { name: /Your Music Map with \d+ tracks/ });
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* no storage */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = '';
});

describe('Music Map page', () => {
  it('opens in 3D with explore controls, and remembers the text size', async () => {
    const stage = await openMap();
    expect(stage).toHaveAttribute('aria-roledescription', '3D music map');
    expect(stage.getAttribute('aria-label')).toMatch(/Drag to rotate.*arrow keys rotate/);
    expect(screen.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');

    const text = screen.getByRole('slider', { name: 'Map text size' });
    fireEvent.change(text, { target: { value: '1.5' } });
    expect(text).toHaveAttribute('aria-valuetext', '150%');
    expect(window.localStorage.getItem('somm:map:labelScale')).toBe('1.5');

    expect(screen.getByRole('slider', { name: '3D depth' })).toBeInTheDocument();
    const spin = screen.getByRole('button', { name: 'Spinning' });
    expect(spin).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(spin);
    expect(screen.getByRole('button', { name: 'Spin' })).toHaveAttribute('aria-pressed', 'false');
    for (const name of ['Top', 'Tilt', 'Side']) expect(screen.getByRole('button', { name })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Layers' }));
    const layers = screen.getByRole('group', { name: 'Map layers' });
    await userEvent.click(within(layers).getByRole('checkbox', { name: 'Songs' }));
    expect(JSON.parse(window.localStorage.getItem('somm:map:layers')!)).toMatchObject({ songs: false, attributes: true });
  });

  it('switches to the 2D map and the list, keeping the text size', async () => {
    await openMap();
    fireEvent.change(screen.getByRole('slider', { name: 'Map text size' }), { target: { value: '1.25' } });
    await userEvent.click(screen.getByRole('radio', { name: '2D' }));
    const flat = screen.getByRole('application', { name: /Your Music Map/ });
    expect(flat).toHaveAttribute('aria-roledescription', 'interactive music map');
    expect(screen.getByRole('button', { name: /Genre family: Electronic/ })).toBeInTheDocument();
    expect(flat.querySelector('svg')!.getAttribute('style')).toContain('--ls: 1.25');
    expect(screen.queryByRole('slider', { name: '3D depth' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.getByRole('region', { name: 'Music Map as a list' })).toBeInTheDocument();
    expect(window.localStorage.getItem('somm:map:mode')).toBe('"list"');
  });

  it('goes full screen, falling back to an in-page view when the browser cannot', async () => {
    await openMap();
    expect(typeof HTMLElement.prototype.requestFullscreen).not.toBe('function');
    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    const stage = document.querySelector('.map-stage')!;
    expect(stage).toHaveClass('is-immersive');
    expect(document.documentElement.style.overflow).toBe('hidden');
    // The explore panel moves over the map in full screen.
    expect(screen.queryByRole('heading', { name: 'Explore' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(stage).not.toHaveClass('is-immersive');
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explore' })).toBeInTheDocument();
  });

  it('saves the map as a poster: orientations, the view and the @handle under the image', async () => {
    await openMap();
    // One in the map's toolbar, one in the Explore panel.
    const buttons = screen.getAllByRole('button', { name: 'Save my map' });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Save my map' });
    expect(await within(dialog).findByText('@tester')).toBeInTheDocument();
    for (const o of ['Portrait', 'Story', 'Square', 'Landscape']) expect(within(dialog).getByRole('radio', { name: new RegExp(o) })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Portrait/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Landscape/ }));
    expect(within(dialog).getByRole('img', { name: 'Preview of your landscape map poster' })).toBeInTheDocument();
    // Opened from the 3D view, the poster starts from the current camera.
    expect(within(dialog).getByRole('radio', { name: 'As I see it' })).toHaveAttribute('aria-checked', 'true');
    const size = within(dialog).getByRole('slider', { name: 'Poster text size' });
    fireEvent.change(size, { target: { value: '1.8' } });
    expect(size).toHaveAttribute('aria-valuetext', '180%');
    const mapSize = within(dialog).getByRole('slider', { name: 'Poster map size' });
    fireEvent.change(mapSize, { target: { value: '1.3' } });
    expect(mapSize).toHaveAttribute('aria-valuetext', '130%, the edges are cropped');

    // jsdom has no canvas, like a browser without canvas support: saving explains it.
    await userEvent.click(within(dialog).getByRole('button', { name: /Download PNG/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This browser cannot draw images.');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('External export guidance', () => {
  it('points to TuneMyMusic in a new tab and on to SOMM', () => {
    renderWithProviders(<ExternalExportCallout target="import" />);
    expect(screen.getByRole('heading', { name: 'Use an external tool to extract the songs from your playlists' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /TuneMyMusic/ });
    expect(links.length).toBe(2);
    for (const l of links) {
      expect(l).toHaveAttribute('href', TUNEMYMUSIC_URL);
      expect(l).toHaveAttribute('target', '_blank');
      expect(l).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(TUNEMYMUSIC_URL).toBe('https://www.tunemymusic.com/home');
    expect(screen.getByRole('link', { name: 'Import my CSV' })).toHaveAttribute('href', '/import');
    expect(screen.getByText(/never sees your music-service password/)).toBeInTheDocument();
  });
});
