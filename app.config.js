const appJson = require('./app.json');

module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;

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
      eas: {
        ...config.extra?.eas,
        ...(projectId ? { projectId } : {}),
      },
    },
  };
};
