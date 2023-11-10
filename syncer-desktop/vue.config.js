const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: true,

      builderOptions: {
        nsis: {
          // 是否一键安装
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          perMachine: true,
          allowElevation: true,
          include: './installer.nsh',
          shortcutName: 'Syncer'
        },
      }
    }
  }
})
