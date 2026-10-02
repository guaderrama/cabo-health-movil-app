import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('router query parsing preserves valid Unicode, spaces, arrays and literal decoding', () => {
  const query = require('query-string');
  assert.deepEqual({ ...query.parse('name=Jos%C3%A9+Garc%C3%ADa&tag=a&tag=b') }, {
    name: 'José García', tag: ['a', 'b'],
  });
  assert.equal(query.parse('value=%FE%41%C3%A9').value, '%FEAé');
  assert.equal(query.parse('value=%FE+text', { decode: false }).value, '%FE+text');
  assert.equal(query.stringify({ value: 'Cabo + salud' }), 'value=Cabo%20%2B%20salud');
});

test('malformed public/deep-link queries cannot monopolize the router decoder', () => {
  // Run the real router dependency in a killable process. The old decoder hangs
  // on this short malformed sequence; never execute that payload in the runner.
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const query = require('query-string');
    const input = '%FE'.repeat(2048);
    assert.equal(query.parse('q=' + input).q, input);
    assert.equal(query.parse('q=' + input + '%C3%A9').q, input + 'é');
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.equal(result.error, undefined, 'malformed decoding exceeded its bounded process budget');
  assert.equal(result.status, 0, result.stderr);
});

test('patched UUID remains compatible with the actual Expo and Xcode consumers', () => {
  for (const consumer of ['xcode', '@expo/ngrok', '@expo/bunyan', '@expo/rudder-sdk-node', 'eas-cli', 'gaxios']) {
    const resolveFromConsumer = createRequire(require.resolve(`${consumer}/package.json`));
    const uuid = resolveFromConsumer('uuid');
    assert.match(uuid.v4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, consumer);
    if (consumer === '@expo/bunyan') assert.equal(typeof uuid.v1(), 'string');
    // Fixed v3/v5 versions must reject an undersized output buffer.
    assert.throws(() => uuid.v5('CaboHealth', uuid.v5.DNS, new Uint8Array(1)), RangeError, consumer);
  }
});
