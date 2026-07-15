const RELEASE_CHANNELS = {
  production: {
    name: 'Syncer',
    androidPackage: 'com.wbbb.syncer',
  },
  beta: {
    name: 'Syncer Beta',
    androidPackage: 'com.wbbb.syncer.beta',
  },
};

module.exports = ({ config }) => {
  const releaseChannel = process.env.SYNCER_RELEASE_CHANNEL ?? 'beta';
  const channel = RELEASE_CHANNELS[releaseChannel];

  if (!channel) {
    throw new Error(`Unsupported Syncer release channel: ${releaseChannel}`);
  }

  return {
    ...config,
    name: channel.name,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDisplayName: channel.name,
      },
    },
    android: {
      ...config.android,
      package: channel.androidPackage,
    },
  };
};
