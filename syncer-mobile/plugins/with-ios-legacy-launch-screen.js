const { IOSConfig, withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');
const { promises: fs } = require('fs');
const path = require('path');

const STORYBOARD_NAME = 'SyncerLaunchScreen';
const STORYBOARD_FILE = `${STORYBOARD_NAME}.storyboard`;

module.exports = function withIosLegacyLaunchScreen(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UILaunchStoryboardName = STORYBOARD_NAME;
    return config;
  });

  config = withXcodeProject(config, (config) => {
    const projectName = config.modRequest.projectName;
    const storyboardPath = path.join(projectName, STORYBOARD_FILE);
    if (!config.modResults.hasFile(storyboardPath)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: storyboardPath,
        groupName: projectName,
        project: config.modResults,
      });
    }
    return config;
  });

  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const source = path.join(__dirname, '..', 'assets', STORYBOARD_FILE);
      const destination = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        STORYBOARD_FILE,
      );
      await fs.copyFile(source, destination);
      return config;
    },
  ]);
};
