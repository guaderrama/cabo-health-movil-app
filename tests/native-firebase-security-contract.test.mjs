import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const read = (path) => readFileSync(path, 'utf8');

test('native Firebase dependencies are exact and the obsolete web client is not direct', () => {
  const dependencies = JSON.parse(read('package.json')).dependencies;
  for (const name of [
    '@react-native-firebase/app',
    '@react-native-firebase/app-check',
    '@react-native-firebase/auth',
    '@react-native-firebase/functions',
  ]) {
    assert.equal(dependencies[name], '26.3.2');
  }
  assert.equal('firebase' in dependencies, false);
  assert.equal(dependencies['expo-dev-client'], '~6.0.20');
  assert.equal(dependencies['expo-secure-store'], '~15.0.8');
  assert.equal(dependencies['expo-build-properties'], '~1.0.10');
  assert.equal(dependencies['expo-crypto'], '~15.0.8');
  assert.equal('expo-updates' in dependencies, false);
});

test('Apple privacy config disables tracking, aggregates Pod manifests, and gates the archive report', () => {
  const packageJson = JSON.parse(read('package.json'));
  const appConfig = JSON.parse(read('app.json')).expo;
  assert.deepEqual(appConfig.ios.privacyManifests, {
    NSPrivacyTracking: false,
    NSPrivacyTrackingDomains: [],
  });
  assert.equal(appConfig.updates, undefined);
  assert.equal(appConfig.runtimeVersion, undefined);
  assert.equal(packageJson.scripts.update, undefined);

  const runbook = read('docs/operations/native-firebase-runtime.md');
  assert.match(runbook, /privacy report/iu);
  assert.match(runbook, /User ID.+Device ID.+diagnostics/isu);
  assert.match(runbook, /block the release/iu);
  assert.match(runbook, /codesign.+appattest-environment/isu);
  assert.match(runbook, /physical iPhone.+TestFlight/isu);
});

test('EAS exposes separate native development profiles for simulator and physical iPhone', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const profiles = JSON.parse(read('eas.json')).build;
  assert.equal(profiles.development.developmentClient, true);
  assert.equal(profiles.development.ios.simulator, true);
  assert.equal(profiles['development-device'].developmentClient, true);
  assert.equal(profiles['development-device'].distribution, 'internal');
  assert.equal(profiles['development-device'].env.APP_ENV, 'development');
  assert.equal(profiles['development-device'].ios?.simulator, undefined);
  assert.equal(
    scripts['build:dev-device'],
    'eas build --platform ios --profile development-device',
  );
});

test('runtime source contains no embedded Firebase identity, debug token, or weak randomness', () => {
  const files = collectSourceFiles('.').filter((path) => (
    !path.startsWith('docs/superpowers/')
    && !path.startsWith('tests/')
    && path !== 'package-lock.json'
  ));
  const source = files.map((path) => read(path)).join('\n');
  const obsoleteProject = ['instalacion', 'mariposas'].join('');
  assert.equal(source.toLowerCase().includes(obsoleteProject), false);
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}|measurementId|messagingSenderId/iu);
  assert.doesNotMatch(source, /Math\.random|FIREBASE_APP_CHECK_DEBUG_TOKEN\s*[:=]\s*['"][^'"]+/u);
  assert.equal(statSync('services/firebase.ts', { throwIfNoEntry: false }), undefined);
  assert.equal(statSync('services/firestore.ts', { throwIfNoEntry: false }), undefined);
});

test('client secrets never enter AsyncStorage or application logs', () => {
  const clientSources = collectSourceFiles('features/clientAccess')
    .concat(['context/ClientAccessContext.tsx', 'context/ClientAccessBootstrap.tsx'])
    .map((path) => read(path))
    .join('\n');
  assert.doesNotMatch(clientSources, /AsyncStorage|console\.(?:debug|info|log|warn|error)/u);
  assert.match(clientSources, /SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/u);
  assert.match(clientSources, /Crypto\.getRandomBytesAsync/u);
  assert.match(clientSources, /Crypto\.getRandomValues/u);
  assert.match(clientSources, /limitedUseAppCheckTokens: true/u);
});

function collectSourceFiles(root) {
  const allowed = /\.(?:cjs|js|json|mjs|ts|tsx)$/u;
  const ignored = new Set([
    '.git',
    '.test-build',
    'dist',
    'lib',
    'node_modules',
    'test-build',
    'tests',
  ]);
  const paths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (entry.isFile() && allowed.test(entry.name)) paths.push(relative('.', absolute));
    }
  };
  visit(root);
  return paths;
}
