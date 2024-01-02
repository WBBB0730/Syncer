const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: true,

      builderOptions: {
        productName: 'Syncer',
        win: {
          icon: './build/icon.png'
        },
        nsis: {
          // 是否一键安装
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: 'always',
          perMachine: true,
          allowElevation: true,
          shortcutName: 'Syncer',
        },
      }
    }
  }
})
