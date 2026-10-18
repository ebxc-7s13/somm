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
  plugins: {
    // The app sits between the status bar and the gesture bar (the window is padded
    // natively; pages do not draw under the bars). Light icons on SOMM's navy.
    SystemBars: { insetsHandling: 'css', style: 'DARK' },
    // New messages in your Trees while the app is in the background.
    LocalNotifications: { smallIcon: 'ic_stat_somm', iconColor: '#5CF2FF' },
  },
};

export default config;
