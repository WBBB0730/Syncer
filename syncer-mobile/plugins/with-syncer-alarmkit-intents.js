const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const { promises: fs } = require('fs');
const path = require('path');

const SOURCE_FILE = 'SyncerAppIntents.swift';

module.exports = function withSyncerAlarmKitIntents(config) {
  config = withXcodeProject(config, (config) => {
    const projectName = config.modRequest.projectName;
    const sourcePath = path.join(projectName, SOURCE_FILE);
    if (!config.modResults.hasFile(sourcePath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: sourcePath,
        groupName: projectName,
        project: config.modResults,
      });
    }
    return config;
  });

  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const source = path.join(__dirname, '..', 'assets', SOURCE_FILE);
      const destination = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        SOURCE_FILE,
      );
      await fs.copyFile(source, destination);
      return config;
    },
  ]);
};
