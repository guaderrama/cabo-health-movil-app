import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && ['.js', '.jsx', '.ts', '.tsx'].includes(extname(path))) files.push(path);
  }
  return files;
}

test('unused Expo FileSystem is excluded from the resolved Apple native graph', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const installed = JSON.parse(
    readFileSync(join(root, 'node_modules/expo-file-system/package.json'), 'utf8'),
  );
  const resolved = JSON.parse(execFileSync(
    process.execPath,
    [
      'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking',
      'resolve',
      '--platform',
      'apple',
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  ));

  assert.equal(installed.version, '19.0.21');
  assert.equal(packageJson.dependencies['expo-file-system'], undefined);
  assert.equal(packageJson.devDependencies['expo-file-system'], undefined);
  assert.deepEqual(packageJson.expo?.autolinking?.ios?.exclude, ['expo-file-system']);
  assert.equal(
    resolved.modules.some((entry) => entry.packageName === 'expo-file-system'),
    false,
  );
});

test('application source does not import Expo FileSystem', () => {
  const sourceRoots = ['app', 'components', 'features', 'hooks', 'i18n', 'services']
    .map((path) => join(root, path))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });

  for (const sourceRoot of sourceRoots) {
    for (const path of walk(sourceRoot)) {
      assert.doesNotMatch(
        readFileSync(path, 'utf8'),
        /(?:\bfrom\s+|\bimport\s*(?:\(|\s)|\brequire\s*\()(['"])expo-file-system(?:\/[^'"]*)?\1/u,
        `${path} imports the excluded native module`,
      );
    }
  }
});
