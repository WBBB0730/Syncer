const ANDROID_PACKAGES = {
  production: 'com.wbbb.syncer',
  beta: 'com.wbbb.syncer.beta',
};

module.exports = ({ config }) => {
  const releaseChannel = process.env.SYNCER_RELEASE_CHANNEL ?? 'beta';
  const androidPackage = ANDROID_PACKAGES[releaseChannel];

  if (!androidPackage) {
    throw new Error(`Unsupported Syncer release channel: ${releaseChannel}`);
  }

  return {
    ...config,
    android: {
      ...config.android,
      package: androidPackage,
    },
  };
};
