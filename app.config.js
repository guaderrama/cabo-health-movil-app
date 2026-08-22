const { existsSync, readFileSync } = require('node:fs');
const { buildNativeFirebaseExpoConfig } = require('./config/nativeFirebaseExpoConfig.cjs');
const baseConfig = require('./app.json').expo;

module.exports = () => buildNativeFirebaseExpoConfig({
  baseConfig,
  env: process.env,
  fileExists: existsSync,
  readFile: (path) => readFileSync(path, 'utf8'),
  projectRoot: __dirname,
});
