import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_INSTALLATION_KEY,
  createClientInstallationPort,
} from '../.test-build/features/clientAccess/clientInstallationStore.js';

function harness(initial = null) {
  let value = initial;
  const calls = [];
  const storage = {
    getItem: async (key) => { calls.push(['get', key]); return value; },
    setItem: async (key, next) => { calls.push(['set', key, next]); value = next; },
    deleteItem: async (key) => { calls.push(['delete', key]); value = null; },
  };
  const random = Uint8Array.from({ length: 32 }, (_, index) => index);
  const port = createClientInstallationPort({
    storage,
    randomBytes: async (length) => {
      calls.push(['random', length]);
      return random;
    },
  });
  return { calls, port, read: () => value };
}

test('creates a 256-bit opaque installation id and verifies the secure-store write', async () => {
  const { calls, port, read } = harness();
  const value = await port.getOrCreate();
  assert.match(value, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(read(), value);
  assert.deepEqual(calls, [
    ['get', CLIENT_INSTALLATION_KEY],
    ['random', 32],
    ['set', CLIENT_INSTALLATION_KEY, value],
    ['get', CLIENT_INSTALLATION_KEY],
  ]);
});

test('reuses an exact stored id without requesting randomness', async () => {
  const existing = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
  const { calls, port } = harness(existing);
  assert.equal(await port.getOrCreate(), existing);
  assert.deepEqual(calls, [['get', CLIENT_INSTALLATION_KEY]]);
});

test('invalid stored state is deleted before a new id is generated', async () => {
  const { calls, port } = harness('client-name-or-malformed-value');
  const value = await port.getOrCreate();
  assert.match(value, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(calls.slice(0, 3), [
    ['get', CLIENT_INSTALLATION_KEY],
    ['delete', CLIENT_INSTALLATION_KEY],
    ['random', 32],
  ]);
});

test('concurrent readers share one generation and clear removes the exact key', async () => {
  const { calls, port } = harness();
  const [left, right, third] = await Promise.all([
    port.getOrCreate(),
    port.getOrCreate(),
    port.getOrCreate(),
  ]);
  assert.equal(left, right);
  assert.equal(right, third);
  assert.equal(calls.filter(([kind]) => kind === 'random').length, 1);
  await port.clear();
  assert.deepEqual(calls.at(-1), ['delete', CLIENT_INSTALLATION_KEY]);
});

test('a failed or altered write never returns an unpersisted installation id', async () => {
  let value = null;
  const port = createClientInstallationPort({
    storage: {
      getItem: async () => value,
      setItem: async (_key, next) => { value = `${next}changed`; },
      deleteItem: async () => { value = null; },
    },
    randomBytes: async () => new Uint8Array(32),
  });

  await assert.rejects(port.getOrCreate(), /client_installation_persistence_failed/u);
});
