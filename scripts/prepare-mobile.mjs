// Writes mobile/www/app-url.js (the server origin the Android shell's fallback
// pages retry) and copies the app icon next to them. Run before `cap sync`.
import { copyFileSync, writeFileSync } from 'node:fs';

const url = (process.env.SOMM_APP_URL ?? '').trim().replace(/\/+$/, '');
if (url && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) {
  console.error('[mobile] SOMM_APP_URL must be an https origin such as https://somm.onrender.com');
  process.exit(1);
}
writeFileSync('mobile/www/app-url.js', `window.SOMM_APP_URL = ${JSON.stringify(url)};\n`);
copyFileSync('public/favicon.svg', 'mobile/www/icon.svg');
console.log(url ? `[mobile] app will load ${url}` : '[mobile] SOMM_APP_URL not set — the app will show setup instructions');
