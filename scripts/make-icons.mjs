// Rasterises the SOMM mark (public/favicon.svg geometry) into the PNG icons that
// browsers and Android need, with no image libraries: shapes are sampled 4×4 per
// pixel and written with node:zlib. Run `npm run icons` after changing the mark.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const BLUE = [0x17, 0x47, 0xff];
const NAVY = [0x07, 0x1a, 0x52];
const WHITE = [0xff, 0xff, 0xff];
const ORANGE = [0xff, 0x7a, 0x24];
const YELLOW = [0xff, 0xd8, 0x3d];

// The mark in favicon.svg's 64×64 space, painted in order.
const MOTIF = [
  { color: WHITE, inside: (x, y) => Math.abs(Math.hypot(x - 32, y - 32) - 15) <= 3.5 },
  { color: ORANGE, inside: (x, y) => segmentDistance(x, y, 43, 21, 54, 12) <= 1.5 },
  { color: YELLOW, inside: (x, y) => Math.hypot(x - 43, y - 21) <= 6 },
  { color: ORANGE, inside: (x, y) => Math.hypot(x - 54, y - 12) <= 3.5 },
];

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedRect(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/**
 * Draw the mark into a w×h RGBA canvas.
 * plate: 'rounded' (the favicon's rounded square), 'circle', 'square' (full bleed) or 'none'.
 * box: side length of the 64-unit design square in pixels; scale shrinks the motif inside it.
 */
function render(w, h, { plate, box = Math.min(w, h), scale = 1, background = null }) {
  const px = new Uint8ClampedArray(w * h * 4);
  if (background) {
    for (let i = 0; i < w * h; i++) px.set([...background, 255], i * 4);
  }
  const ox = (w - box) / 2;
  const oy = (h - box) / 2;
  const unit = box / 64;
  const layers = [];
  if (plate === 'rounded') layers.push({ color: BLUE, inside: (x, y) => insideRoundedRect(x, y, 64, 16) });
  if (plate === 'circle') layers.push({ color: BLUE, inside: (x, y) => Math.hypot(x - 32, y - 32) <= 32 });
  if (plate === 'square') layers.push({ color: BLUE, inside: (x, y) => x >= 0 && x <= 64 && y >= 0 && y <= 64 });
  for (const m of MOTIF) {
    // Motif coordinates are scaled about the centre of the design square.
    layers.push({ color: m.color, inside: (x, y) => m.inside(32 + (x - 32) / scale, 32 + (y - 32) / scale) });
  }
  const N = 4;
  const x0 = Math.max(0, Math.floor(ox));
  const y0 = Math.max(0, Math.floor(oy));
  const x1 = Math.min(w, Math.ceil(ox + box));
  const y1 = Math.min(h, Math.ceil(oy + box));
  for (let py = y0; py < y1; py++) {
    for (let pxi = x0; pxi < x1; pxi++) {
      const i = (py * w + pxi) * 4;
      let r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255, a = px[i + 3] / 255;
      for (const layer of layers) {
        let hits = 0;
        for (let sy = 0; sy < N; sy++) {
          for (let sx = 0; sx < N; sx++) {
            const ux = (pxi + (sx + 0.5) / N - ox) / unit;
            const uy = (py + (sy + 0.5) / N - oy) / unit;
            if (layer.inside(ux, uy)) hits++;
          }
        }
        if (!hits) continue;
        const ca = hits / (N * N);
        const [lr, lg, lb] = layer.color.map((c) => c / 255);
        const na = ca + a * (1 - ca);
        r = (lr * ca + r * a * (1 - ca)) / na;
        g = (lg * ca + g * a * (1 - ca)) / na;
        b = (lb * ca + b * a * (1 - ca)) / na;
        a = na;
      }
      px[i] = Math.round(r * 255);
      px[i + 1] = Math.round(g * 255);
      px[i + 2] = Math.round(b * 255);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(w, h, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(w, h, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngSize(path) {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function write(path, png) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, png);
  console.log(`[icons] ${path}`);
}

// Web app (PWA) icons. Maskable icons keep the motif inside the central 80% safe zone.
write('public/icons/icon-192.png', render(192, 192, { plate: 'rounded' }));
write('public/icons/icon-512.png', render(512, 512, { plate: 'rounded' }));
write('public/icons/maskable-512.png', render(512, 512, { plate: 'square', scale: 0.72 }));
write('public/icons/apple-touch-icon.png', render(180, 180, { plate: 'square', scale: 0.86 }));

// Android launcher icons and splash screens (only when the Capacitor project exists).
const res = 'android/app/src/main/res';
if (existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [name, f] of Object.entries(densities)) {
    const legacy = Math.round(48 * f);
    write(`${res}/mipmap-${name}/ic_launcher.png`, render(legacy, legacy, { plate: 'rounded' }));
    write(`${res}/mipmap-${name}/ic_launcher_round.png`, render(legacy, legacy, { plate: 'circle', scale: 0.82 }));
    // Adaptive icon foreground: 108dp canvas, background colour comes from ic_launcher_background.
    const fg = Math.round(108 * f);
    write(`${res}/mipmap-${name}/ic_launcher_foreground.png`, render(fg, fg, { plate: 'none', scale: 0.55 }));
  }
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const path = `${res}/${dir}/splash.png`;
    if (!existsSync(path)) continue;
    const { w, h } = pngSize(path);
    write(path, render(w, h, { plate: 'rounded', box: Math.round(Math.min(w, h) * 0.3), background: NAVY }));
  }
}
