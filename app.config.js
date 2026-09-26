const appJson = require('./app.json');

module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'https://rideon-api-262g.onrender.com';
  // One-key compatibility: the same public Maps key can be used for both native platforms.
  const googleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';
  const androidMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || googleMapsKey;
  const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || googleMapsKey;
  const easChannel = process.env.EAS_UPDATE_CHANNEL || process.env.EAS_CHANNEL || '';
  const isProduction = easChannel === 'production' || process.env.EAS_BUILD_PROFILE === 'production';

  if (isProduction && (!apiUrl || /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|\/)/i.test(apiUrl))) {
    throw new Error('Production Expo builds require a non-local EXPO_PUBLIC_API_URL.');
  }

  return {
    ...appJson.expo,
    ...config,
    plugins: [
      ...(Array.isArray(appJson.expo?.plugins) ? appJson.expo.plugins : []),
      'expo-image-picker',
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
