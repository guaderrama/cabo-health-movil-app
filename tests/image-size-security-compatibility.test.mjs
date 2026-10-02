import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const metroAssetsPath = join(dirname(require.resolve('metro/package.json')), 'src/Assets.js');
const { getAssetData, getAssetSize } = require(metroAssetsPath);
const iconPath = join(root, 'assets/icon.png');

// GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq: a PNG extension is
// insufficient because image-size detects format from bytes, not the filename.
// A killable, memory-bounded child keeps a vulnerable parser out of this runner.
const malformedImages = [
  { name: 'ICNS zero-length entry', hex: '69636e73000000106963703400000000' },
  {
    name: 'JXL zero-length partial codestream',
    hex: '0000000c4a584c200d0a870a00000010667479706a786c2000000000000000006a786c7000000000',
  },
  { name: 'HEIF zero-length box', hex: '00000000667479706865696300000000' },
];

for (const { name, hex } of malformedImages) {
  test(`Metro rejects ${name} renamed as PNG without hanging`, () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
      const assert = require('node:assert/strict');
      const { getAssetSize } = require(${JSON.stringify(metroAssetsPath)});
      assert.throws(() => getAssetSize('png', Buffer.from('${hex}', 'hex'), 'untrusted.png'));
      process.stdout.write('rejected');
    `], { cwd: root, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 });
    assert.equal(result.error, undefined, `${name}: parser exceeded its bounded process budget`);
    assert.equal(result.status, 0, `${name}: parser must reject normally, not crash (${result.signal})`);
    assert.equal(result.stdout, 'rejected');
  });
}

test('Metro still reads the app PNG from its ordinary filesystem path', async () => {
  const asset = await getAssetData(iconPath, 'assets/icon.png', [], 'ios', '/assets');
  assert.equal(asset.width, 1024);
  assert.equal(asset.height, 1024);
  assert.equal(asset.name, 'icon');
  assert.equal(asset.type, 'png');
  assert.deepEqual(asset.scales, [1]);
  assert.deepEqual(asset.files, [iconPath]);
});

test('Metro buffer dimensions remain compatible with image-size', () => {
  assert.deepEqual(getAssetSize('png', fs.readFileSync(iconPath), iconPath), { width: 1024, height: 1024 });
  assert.equal(getAssetSize('txt', Buffer.from('not an image'), 'note.txt'), null);
  assert.throws(() => getAssetSize('png', Buffer.alloc(0), 'empty.png'), /empty file/u);
});

test('Metro retains the buffer branch for zip paths when async file handles are unavailable', async (t) => {
  const fixtureRoot = fs.mkdtempSync(join(tmpdir(), 'cabohealth-image-size-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const zipDirectory = join(fixtureRoot, 'dependency.zip');
  fs.mkdirSync(zipDirectory);
  const assetPath = join(zipDirectory, 'icon@2x.png');
  fs.copyFileSync(iconPath, assetPath);

  // Zip-backed filesystems may support readFileSync but not native fs.open.
  // Keep Metro, directory discovery, hashing and image parsing real; emulate
  // only that filesystem limitation so accidentally taking fromFile fails.
  const originalOpen = fs.promises.open;
  t.mock.method(fs.promises, 'open', function (path, ...args) {
    if (String(path).includes('.zip/')) throw new Error('Zip-backed async file handles are unavailable');
    return originalOpen.call(this, path, ...args);
  });
  const asset = await getAssetData(assetPath, 'icon@2x.png', [], 'ios', '/assets');
  assert.equal(asset.width, 512);
  assert.equal(asset.height, 512);
  assert.deepEqual(asset.scales, [2]);
  assert.deepEqual(asset.files, [assetPath]);
});
