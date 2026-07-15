const { version } = require('./package.json');

const productName = /-beta\.\d+$/.test(version) ? 'Syncer Beta' : 'Syncer';

module.exports = {
  extends: './electron-builder.yml',
  productName,
  win: {
    executableName: productName,
  },
  nsis: {
    shortcutName: productName,
  },
};
