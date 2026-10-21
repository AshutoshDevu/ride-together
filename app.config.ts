import type { ExpoConfig } from 'expo/config';

/**
 * All secrets / per-environment values come from `.env` (see `.env.example`).
 * Expo loads `.env` automatically for both the app bundle and this config file.
 */
const BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'com.ashutoshdevu.ridetogether';
const INVITE_HOST = (process.env.EXPO_PUBLIC_INVITE_BASE_URL || 'https://ridetogether-ashu.web.app')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

const config: ExpoConfig = {
  name: 'RideTogether',
  slug: 'ride-together',
  scheme: 'ridetogether',
  version: '1.2.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // Follows the phone's light/dark setting (riders can override in the app)
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    // Universal links: https://<invite host>/join/CODE opens the app directly
    associatedDomains: [`applinks:${INVITE_HOST}`],
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
    },
    infoPlist: {
      UIBackgroundModes: ['location'],
      LSApplicationQueriesSchemes: ['whatsapp'],
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#0E0F12',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'WAKE_LOCK',
    ],
    // Android App Links: https://<invite host>/join/CODE opens the app directly
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: INVITE_HOST, pathPrefix: '/join' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'RideTogether shows your position to riders in your group so nobody gets lost.',
        locationAlwaysAndWhenInUsePermission:
          'Allow "Always" so your group can still see you while your phone is locked in your pocket or mount.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  web: {
    // Single-page app served from https://<invite host>/app (Firebase Hosting rewrites /app/** to it)
    output: 'single',
    bundler: 'metro',
  },
  experiments: {
    typedRoutes: false,
    // Only the deployed website lives under /app (npm run build:web sets this). The dev server
    // stays at the root — expo-router doesn't strip the base URL in development.
    baseUrl: process.env.EXPO_WEB_BASE_URL || undefined,
  },
  owner: 'ashu260402',
  extra: {
    eas: { projectId: '3f6f2634-9b88-4dfe-a7c6-20d62497929e' },
  },
};

export default config;
