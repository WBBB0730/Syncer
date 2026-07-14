const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const { promises: fs } = require('fs');
const path = require('path');

const APPLY_LINE = 'apply from: "./syncer-signing.gradle"';
const SIGNING_SCRIPT = `def syncerSigningEnvironment = [
    'SYNCER_ANDROID_KEYSTORE_FILE': System.getenv('SYNCER_ANDROID_KEYSTORE_FILE'),
    'SYNCER_ANDROID_KEYSTORE_PASSWORD': System.getenv('SYNCER_ANDROID_KEYSTORE_PASSWORD'),
    'SYNCER_ANDROID_KEY_ALIAS': System.getenv('SYNCER_ANDROID_KEY_ALIAS'),
    'SYNCER_ANDROID_KEY_PASSWORD': System.getenv('SYNCER_ANDROID_KEY_PASSWORD'),
]

android {
    signingConfigs {
        release {
            def keystoreFile = syncerSigningEnvironment['SYNCER_ANDROID_KEYSTORE_FILE']
            if (keystoreFile) storeFile rootProject.file(keystoreFile)
            storePassword syncerSigningEnvironment['SYNCER_ANDROID_KEYSTORE_PASSWORD']
            keyAlias syncerSigningEnvironment['SYNCER_ANDROID_KEY_ALIAS']
            keyPassword syncerSigningEnvironment['SYNCER_ANDROID_KEY_PASSWORD']
        }
    }
    buildTypes.release.signingConfig signingConfigs.release
}

tasks.matching { task -> task.name == 'preReleaseBuild' }.configureEach {
    doFirst {
        def missingVariables = syncerSigningEnvironment
            .findAll { name, value -> value == null || value.isEmpty() }
            .keySet()
            .sort()
        if (!missingVariables.isEmpty()) {
            throw new GradleException("Missing release signing environment variables: \${missingVariables.join(', ')}")
        }

        def keystoreFile = rootProject.file(syncerSigningEnvironment['SYNCER_ANDROID_KEYSTORE_FILE'])
        if (!keystoreFile.isFile()) {
            throw new GradleException("Release keystore does not exist: \${keystoreFile}")
        }
    }
}
`;

module.exports = function withAndroidReleaseSigning(config) {
  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('Syncer Android release signing requires a Groovy app build file.');
    }
    if (!config.modResults.contents.includes(APPLY_LINE)) {
      config.modResults.contents = `${config.modResults.contents.trimEnd()}\n\n${APPLY_LINE}\n`;
    }
    return config;
  });

  return withDangerousMod(config, [
    'android',
    async (config) => {
      const destination = path.join(config.modRequest.platformProjectRoot, 'app', 'syncer-signing.gradle');
      await fs.writeFile(destination, SIGNING_SCRIPT, 'utf8');
      return config;
    },
  ]);
};
