const appJson = require('./app.json');

module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
  const easChannel = process.env.EAS_UPDATE_CHANNEL || process.env.EAS_CHANNEL || '';
  const isProduction = easChannel === 'production' || process.env.EAS_BUILD_PROFILE === 'production';

  if (isProduction && (!apiUrl || /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|\/)/i.test(apiUrl))) {
    throw new Error('Production Expo builds require a non-local EXPO_PUBLIC_API_URL.');
  }

  return {
    ...appJson.expo,
    ...config,
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
