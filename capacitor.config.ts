/**
 * Android app shell (Capacitor). The app loads the hosted SOMM server directly,
 * so sign-in cookies stay first-party and every web update ships without a new
 * APK. SOMM_APP_URL is the deployed https origin (a GitHub repository variable
 * in CI); see docs/DEPLOYMENT.md § Android app.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const appUrl = process.env.SOMM_APP_URL?.trim().replace(/\/+$/, '');
if (appUrl && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(appUrl)) {
  throw new Error('SOMM_APP_URL must be an https origin such as https://somm.onrender.com');
}

const config: CapacitorConfig = {
  appId: 'io.github.ebxc7s13.somm',
  appName: 'SOMM',
  // Local fallback pages only: shown when no server URL is configured or the server is unreachable.
  webDir: 'mobile/www',
  ...(appUrl
    ? {
        server: {
          url: appUrl,
          cleartext: false,
          errorPath: 'offline.html',
          // Spotify sign-in must stay inside the app so its redirect returns here.
          allowNavigation: ['accounts.spotify.com'],
        },
      }
    : {}),
  android: {
    allowMixedContent: false,
    backgroundColor: '#071A52',
  },
};

export default config;
