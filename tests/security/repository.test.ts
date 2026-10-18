/**
 * Repository hygiene: no committed secrets, placeholder-only .env.example,
 * no server secrets referenced from client code, and clean UTF-8 sources.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.vercel', '.git', 'data', 'coverage'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json|css|html|md|sql|example)$/.test(name) || name === '.gitignore') out.push(p);
  }
  return out;
}

const files = walk(root);
const read = (p: string) => readFileSync(p, 'utf8');

describe('repository hygiene', () => {
  it('ignores secrets and local data in git', () => {
    const gitignore = read(join(root, '.gitignore'));
    for (const pattern of ['.env', 'data/', '*.sqlite', 'node_modules/', 'dist/', '*.p12', '*.jks', '*.keystore']) expect(gitignore).toContain(pattern);
    expect(gitignore).toContain('!.env.example');
  });

  it('keeps Android signing keys out of the repository', () => {
    const keys: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git', 'data', 'coverage', 'build'].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(p12|jks|keystore|pfx)$/i.test(name)) keys.push(p);
      }
    };
    scan(root);
    expect(keys).toEqual([]);
  });

  it('keeps the database URL out of the Render blueprint', () => {
    const blueprint = read(join(root, 'render.yaml'));
    expect(blueprint).not.toMatch(/postgres(ql)?:\/\//);
    expect(blueprint).toMatch(/key: DATABASE_URL\s+sync: false/);
  });

  it('ships .env.example with placeholders only', () => {
    const env = read(join(root, '.env.example'));
    for (const key of ['TOKEN_ENCRYPTION_KEY', 'SPOTIFY_CLIENT_ID', 'YOUTUBE_API_KEY', 'APPLE_MUSIC_KEY_ID', 'TURN_CREDENTIAL', 'MUSICBRAINZ_CONTACT']) {
      expect(env).toMatch(new RegExp(`^${key}=\\s*$`, 'm'));
    }
  });

  it('contains no secret-looking values', () => {
    const patterns = [
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bsk-(?:live|ant|proj)?[-_A-Za-z0-9]{20,}/,
      /\bAIza[0-9A-Za-z_-]{35}\b/,
      /\bghp_[0-9A-Za-z]{36}\b/,
      /(?:SECRET|TOKEN|API_KEY|PASSWORD)\s*=\s*['"]?[A-Za-z0-9+/_-]{24,}/,
    ];
    const offenders = files.filter((f) => !f.includes(`${join('tests', 'security')}`) && patterns.some((re) => re.test(read(f))));
    expect(offenders).toEqual([]);
  });

  it('never references server secrets from client code', () => {
    const client = files.filter((f) => f.includes(join('src', 'client')));
    expect(client.length).toBeGreaterThan(10);
    for (const f of client) {
      const text = read(f);
      expect(text, f).not.toMatch(/process\.env/);
      expect(text, f).not.toMatch(/TOKEN_ENCRYPTION_KEY|SPOTIFY_CLIENT_SECRET|YOUTUBE_API_KEY|APPLE_MUSIC_PRIVATE_KEY/);
      expect(text, f).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it('keeps the built client bundle free of server configuration (when built)', () => {
    const dir = join(root, 'dist', 'client', 'assets');
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const text = read(join(dir, name));
      expect(text, name).not.toMatch(/TOKEN_ENCRYPTION_KEY|YOUTUBE_API_KEY|APPLE_MUSIC_PRIVATE_KEY_PATH|MUSICBRAINZ_CONTACT/);
    }
  });

  it('ships fonts as files, as the Content Security Policy (font-src self) requires', async () => {
    const { default: viteConfig } = await import('../../vite.config');
    const inline = viteConfig.build?.assetsInlineLimit;
    expect(typeof inline).toBe('function');
    const decide = inline as (file: string, content: Buffer) => boolean | undefined;
    for (const font of ['a/unbounded-cyrillic-ext-wght-normal.woff2', 'b/inter.woff', 'c/x.ttf']) expect(decide(font, Buffer.alloc(10))).toBe(false);
    expect(decide('d/icon.svg', Buffer.alloc(10))).toBeUndefined();
    const dir = join(root, 'dist', 'client', 'assets');
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.css'))) expect(read(join(dir, name)), name).not.toContain('url(data:font');
  });

  it('has clean UTF-8 sources (no double-encoded characters or stray BOMs)', () => {
    // Built from char codes so this file stays ASCII: U+00E2 U+20AC, or U+00C3 followed by U+0080..U+00BF.
    const c = String.fromCharCode;
    const mojibake = new RegExp(`${c(0xe2)}${c(0x20ac)}|${c(0xc3)}[${c(0x80)}-${c(0xbf)}]`);
    const bad = files.filter((f) => mojibake.test(read(f)) || read(f).charCodeAt(0) === 0xfeff);
    expect(bad).toEqual([]);
  });
});
