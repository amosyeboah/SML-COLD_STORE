import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.smllegacy.coldstore',
  appName: 'SML Legacy Cold Store',
  webDir: 'out/renderer',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https'
  }
};

export default config;
