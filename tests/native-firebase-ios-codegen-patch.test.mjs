import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

const cases = [
  {
    name: 'App',
    namespace: 'JS::NativeRNFBTurboApp',
    implementation: 'node_modules/@react-native-firebase/app/ios/RNFBApp/RNFBAppModule.mm',
    generated: 'node_modules/@react-native-firebase/app/ios/generated/RNFBAppTurboModules/RNFBAppTurboModules.h',
  },
  {
    name: 'Utils',
    namespace: 'JS::NativeRNFBTurboUtils',
    implementation: 'node_modules/@react-native-firebase/app/ios/RNFBApp/RNFBUtilsModule.mm',
    generated: 'node_modules/@react-native-firebase/app/ios/generated/RNFBAppTurboModules/RNFBAppTurboModules.h',
  },
  {
    name: 'Auth',
    namespace: 'JS::NativeRNFBTurboAuth',
    implementation: 'node_modules/@react-native-firebase/auth/ios/RNFBAuth/RNFBAuthModule.mm',
    generated: 'node_modules/@react-native-firebase/auth/ios/generated/RNFBAuthTurboModules/RNFBAuthTurboModules.h',
  },
];

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), 'utf8');
}

function returnType(source, namespace, method) {
  const pattern = new RegExp(
    `- \\(facebook::react::ModuleConstants<(${namespace}::Constants(?:::Builder)?)>\\)\\s*${method}\\b`,
    'gu',
  );
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, `${namespace} ${method} must have one exact signature`);
  return matches[0][1];
}

test('the RNFirebase 26.3.2 iOS implementations match their generated protocols', () => {
  for (const entry of cases) {
    const implementation = read(entry.implementation);
    const generated = read(entry.generated);
    for (const method of ['constantsToExport', 'getConstants']) {
      const implementationType = returnType(implementation, entry.namespace, method);
      const generatedType = returnType(generated, entry.namespace, method);
      assert.equal(implementationType, generatedType, `${entry.name} ${method} type drifted`);
      assert.equal(implementationType, `${entry.namespace}::Constants`);
    }
  }
});

test('RNFirebase App 26.3.2 strips its unused PhotoKit helpers and framework declaration', () => {
  const packageJson = JSON.parse(read('node_modules/@react-native-firebase/app/package.json'));
  const podspec = read('node_modules/@react-native-firebase/app/RNFBApp.podspec');
  const header = read('node_modules/@react-native-firebase/app/ios/RNFBApp/RNFBUtilsModule.h');
  const implementation = read(
    'node_modules/@react-native-firebase/app/ios/RNFBApp/RNFBUtilsModule.mm',
  );
  const protectedPhotoSurface = /(?:frameworks\s*=\s*['"]Photos['"]|Photos(?:\.framework|\/Photos\.h)|\bPH(?:Asset|AssetResourceManager|PhotoLibrary|ImageManager)|fetchAssetForPath|isRemoteAsset)/u;

  assert.equal(packageJson.version, '26.3.2');
  assert.doesNotMatch(podspec, protectedPhotoSurface);
  assert.doesNotMatch(header, protectedPhotoSurface);
  assert.doesNotMatch(implementation, protectedPhotoSurface);
  assert.match(implementation, /\+ \(BOOL\)unused_isHeic:/u);
});

test('the fail-closed install hook retains the exact reviewed native patches', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies['@react-native-firebase/app'], '26.3.2');
  assert.equal(packageJson.dependencies['@react-native-firebase/auth'], '26.3.2');
  assert.equal(
    packageJson.scripts.postinstall,
    'patch-package --error-on-fail --error-on-warn',
  );
  assert.equal(packageJson.devDependencies['patch-package'], '8.0.1');

  const appPatch = read('patches/@react-native-firebase+app+26.3.2.patch');
  const authPatch = read('patches/@react-native-firebase+auth+26.3.2.patch');
  assert.deepEqual(
    readdirSync(new URL('../patches/', import.meta.url)).sort(),
    [
      '@react-native-firebase+app+26.3.2.patch',
      '@react-native-firebase+auth+26.3.2.patch',
      'react-native-webview+13.15.0.patch',
    ],
  );
  const patchBytes = `${appPatch}\n${authPatch}`;
  assert.equal((appPatch.match(/^diff --git /gmu) ?? []).length, 4);
  assert.equal((authPatch.match(/^diff --git /gmu) ?? []).length, 1);
  assert.equal(
    (patchBytes.match(/^-- \(facebook::react::ModuleConstants<.*::Builder>\)/gmu) ?? []).length,
    6,
  );
  assert.equal(
    (patchBytes.match(/^\+- \(facebook::react::ModuleConstants<.*::Constants>\)/gmu) ?? []).length,
    6,
  );
  assert.match(appPatch, /^-#import <Photos\/Photos\.h>$/mu);
  assert.match(appPatch, /^-  s\.ios\.frameworks = 'Photos'$/mu);
  assert.match(appPatch, /^-\+ \(PHAsset \*\)fetchAssetForPath:/mu);
  assert.doesNotMatch(appPatch, /^\+.*(?:PHAsset|PHPhotoLibrary|Photos\/Photos)/mu);
});
