const appJson = require('./app.json');

module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const easBuildProfile = process.env.EAS_BUILD_PROFILE || '';
  const isProduction = easBuildProfile === 'production' || process.env.EAS_UPDATE_CHANNEL === 'production';
  const isLocalDevelopment = easBuildProfile === 'development' || process.env.NODE_ENV === 'development';
  const apiUrl = String(process.env.EXPO_PUBLIC_API_URL || (isLocalDevelopment ? 'http://localhost:4000' : '')).trim();
  // One-key compatibility: the same public Maps key can be used for both native platforms.
  const googleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  const androidMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || googleMapsKey;
  const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || googleMapsKey;
  const easChannel = process.env.EAS_UPDATE_CHANNEL || process.env.EAS_CHANNEL || '';

  if (!apiUrl) {
    throw new Error(isProduction ? 'Production Expo builds require EXPO_PUBLIC_API_URL pointing to the production API.' : 'This Expo build requires EXPO_PUBLIC_API_URL.');
  }

  return {
    ...appJson.expo,
    ...config,
    plugins: [
      ...(Array.isArray(appJson.expo?.plugins) ? appJson.expo.plugins : []),
      'expo-image-picker',
      ['expo-notifications', { icon: './assets/notification-icon.png', color: '#E85D35', sounds: [] }],
      ['expo-location', { locationWhenInUsePermission: 'Allow RideOn to use your location to find vendors and estimate delivery distance.', locationAlwaysAndWhenInUsePermission: 'Allow RideOn to share your location only while an active vehicle delivery is in progress.', isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: true, isIosBackgroundLocationEnabled: true }],
      ['react-native-maps', {
        ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
        ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}),
      }],
    ].filter((item, index, all) => all.indexOf(item) === index),
    updates: projectId
      ? {
          url: `https://u.expo.dev/${projectId}`,
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
        }
      : config.updates,
    runtimeVersion: {
      policy: 'appVersion',
    },
    extra: {
      ...config.extra,
      apiUrl,
      releaseChannel: easChannel || undefined,
      eas: {
        ...config.extra?.eas,
        ...(projectId ? { projectId } : {}),
      },
    },
  };
};
