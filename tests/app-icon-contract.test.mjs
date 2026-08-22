import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const iconPath = fileURLToPath(new URL('../assets/icon.png', import.meta.url));

test('the App Store icon is exactly 1024 square and fully opaque', () => {
  const png = readFileSync(iconPath);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[25], 2, 'icon must use opaque RGB rather than an alpha-bearing PNG color type');
  assert.equal(png.includes(Buffer.from('tRNS')), false, 'icon must not define PNG transparency');
});
