import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOrderedPersistence,
  readStoredValue,
} from '../.test-build/features/preferences/persistencePolicy.js';

test('stored preference reads distinguish missing values, valid values, and storage failures', async () => {
  const missing = await readStoredValue(
    { getItem: async () => null },
    '@language',
    (value) => value === 'es-MX' ? 'es-MX' : 'en',
    'en',
  );
  const value = await readStoredValue(
    { getItem: async () => 'es-MX' },
    '@language',
    (stored) => stored === 'es-MX' ? 'es-MX' : 'en',
    'en',
  );
  const failure = await readStoredValue(
    { getItem: async () => { throw new Error('private storage detail'); } },
    '@language',
    (stored) => stored,
    'en',
  );

  assert.deepEqual(missing, { status: 'missing', value: 'en' });
  assert.deepEqual(value, { status: 'value', value: 'es-MX' });
  assert.deepEqual(failure, { status: 'error', value: 'en' });
});

test('ordered persistence commits and success feedback only after each write resolves', async () => {
  const events = [];
  let resolveFirst;
  const firstWrite = new Promise((resolve) => { resolveFirst = resolve; });
  const writer = createOrderedPersistence({
    persist: async (value) => {
      events.push(`persist:${value}:start`);
      if (value === 'first') await firstWrite;
      events.push(`persist:${value}:done`);
    },
    onCommit: (value) => {
      events.push(`commit:${value}`);
      events.push(`haptic:${value}`);
    },
    onFailure: (value) => events.push(`failure:${value}`),
  });

  const first = writer.submit('first');
  const second = writer.submit('second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['persist:first:start']);

  resolveFirst();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(events, [
    'persist:first:start',
    'persist:first:done',
    'commit:first',
    'haptic:first',
    'persist:second:start',
    'persist:second:done',
    'commit:second',
    'haptic:second',
  ]);
});

test('failed persistence does not commit and the same change can be retried', async () => {
  const events = [];
  let attempts = 0;
  const writer = createOrderedPersistence({
    persist: async (value) => {
      attempts += 1;
      events.push(`persist:${value}:${attempts}`);
      if (attempts === 1) throw new Error('private write detail');
    },
    onCommit: (value) => events.push(`commit:${value}`),
    onFailure: (value) => events.push(`failure:${value}`),
  });

  assert.equal(await writer.submit('es-MX'), false);
  assert.deepEqual(events, ['persist:es-MX:1', 'failure:es-MX']);
  assert.equal(await writer.submit('es-MX'), true);
  assert.deepEqual(events, [
    'persist:es-MX:1',
    'failure:es-MX',
    'persist:es-MX:2',
    'commit:es-MX',
  ]);
});
