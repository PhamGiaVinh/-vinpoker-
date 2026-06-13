import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.vbacker',
  appName: 'VBacker',
  // Vite build output. `npx cap sync` copies this into the native projects.
  webDir: 'dist',
  // Serve the bundled web assets from the local origin
  // (https://localhost on Android, capacitor://localhost on iOS) so the app
  // runs from the packaged build. The existing web code already treats the
  // `localhost` host as a non-web context, so the service worker and
  // OneSignal web SDK self-disable inside the native shell.
  server: {
    androidScheme: 'https',
  },
};

export default config;
