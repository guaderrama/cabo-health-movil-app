const { existsSync, readFileSync } = require('node:fs');
const { buildNativeFirebaseExpoConfig } = require('./config/nativeFirebaseExpoConfig.cjs');

module.exports = ({ config }) => buildNativeFirebaseExpoConfig({
  baseConfig: config,
  env: process.env,
  fileExists: existsSync,
  readFile: (path) => readFileSync(path, 'utf8'),
  projectRoot: __dirname,
});
