/**
 * Live smoke test for metadata sources (`npm run smoke:metadata -- "Artist" "Title"`).
 * Makes at most 3 MusicBrainz requests (only when MUSICBRAINZ_CONTACT is set) and
 * 1 iTunes Search request. Prints what SOMM would store.
 */
import { ItunesClient } from '../enrich/itunes';
import { MusicBrainzClient, pickRecording, weightGenres } from '../enrich/musicbrainz';
import { loadConfig, loadDotEnv } from '../config';

loadDotEnv();
const config = loadConfig();
const [artist = 'Daft Punk', title = 'Digital Love'] = process.argv.slice(2);

async function main() {
  console.log(`[smoke] looking up “${title}” by ${artist}`);
  try {
    const itunes = await new ItunesClient().lookupGenre(title, artist, null);
    console.log('[smoke] iTunes Search:', itunes ?? 'no confident match');
  } catch (err) {
    console.log('[smoke] iTunes Search failed:', (err as Error).message);
  }
  if (!config.musicbrainz.contact) {
    console.log('[smoke] MusicBrainz skipped: set MUSICBRAINZ_CONTACT (an email or URL where MetaBrainz can reach you).');
    return;
  }
  const mb = new MusicBrainzClient(config.musicbrainz.contact);
  const results = await mb.searchRecording(title, artist);
  const best = pickRecording(results, title, artist, null);
  console.log(`[smoke] MusicBrainz search: ${results.length} results, best: ${best ? `${best.title} (${best.id}, score ${best.score})` : 'none'}`);
  if (!best) return;
  const rec = await mb.getRecording(best.id);
  console.log('[smoke] recording genres →', weightGenres(rec.genres));
  console.log('[smoke] tags →', rec.tags.slice(0, 8));
  console.log('[smoke] instrument credits →', rec.instruments.slice(0, 8));
  console.log('[smoke] first release →', rec.firstReleaseDate);
}

main().catch((err) => {
  console.error('[smoke] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
