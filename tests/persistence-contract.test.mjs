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

test('the latest failed queued write can reconcile an optimistic intention to the last commit', async () => {
  const slug = 'healthy-recipes';
  const writes = [];
  let committed = [];
  let intended = [];
  const writer = createOrderedPersistence({
    persist: async (value) => {
      writes.push(value);
      if (writes.length === 2) throw new Error('private write detail');
    },
    onCommit: (value, settlement) => {
      committed = value;
      if (settlement.isLatest) intended = value;
    },
    onFailure: (_value, settlement) => {
      if (settlement.isLatest) intended = committed;
    },
  });
  const toggle = () => {
    intended = intended.includes(slug) ? [] : [slug];
    return writer.submit(intended);
  };

  const first = toggle();
  const second = toggle();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.deepEqual(committed, [slug]);
  assert.deepEqual(intended, [slug]);

  assert.equal(await toggle(), true);
  assert.deepEqual(writes, [[slug], [], []]);
  assert.deepEqual(committed, []);
  assert.deepEqual(intended, []);
});

const providerScenarios = [
  {
    name: 'Favorites',
    initial: ['healthy-recipes'],
    staleRead: [],
    next: ['healthy-recipes', 'clinic-guide'],
  },
  {
    name: 'Preferences',
    initial: { language: 'en', haptics: true, reducedEffects: false },
    staleRead: { language: 'en', haptics: true, reducedEffects: false },
    next: { language: 'es-MX', haptics: false, reducedEffects: true },
  },
  {
    name: 'Theme',
    initial: 'system',
    staleRead: 'light',
    next: 'dark',
  },
];

function createStateCoordinator(scenario, persist) {
  let state = scenario.initial;
  let issue = 'read-error';
  const coordinator = createOrderedPersistence({
    persist,
    onCommit: (value) => {
      state = value;
      issue = null;
    },
    onFailure: () => {
      issue = `${scenario.name}-write-error`;
    },
  });
  return {
    coordinator,
    snapshot: () => ({ state, issue }),
    applyRead: (read) => read.applyCurrent(() => {
      state = scenario.staleRead;
      issue = null;
    }),
  };
}

test('retry reads begun before later Favorites, Preferences, or Theme writes cannot overwrite success', async (t) => {
  for (const scenario of providerScenarios) {
    await t.test(scenario.name, async () => {
      const fixture = createStateCoordinator(scenario, async () => {});
      const retryRead = fixture.coordinator.beginRead();

      assert.equal(await fixture.coordinator.submit(scenario.next), true);
      assert.equal(fixture.applyRead(retryRead), false);
      assert.deepEqual(fixture.snapshot(), { state: scenario.next, issue: null });
    });
  }
});

test('retry reads begun during Favorites, Preferences, or Theme writes cannot overwrite success', async (t) => {
  for (const scenario of providerScenarios) {
    await t.test(scenario.name, async () => {
      let resolveWrite;
      const pendingWrite = new Promise((resolve) => { resolveWrite = resolve; });
      const fixture = createStateCoordinator(scenario, async () => pendingWrite);
      const write = fixture.coordinator.submit(scenario.next);
      await new Promise((resolve) => setImmediate(resolve));
      const retryRead = fixture.coordinator.beginRead();

      resolveWrite();
      assert.equal(await write, true);
      assert.equal(fixture.applyRead(retryRead), false);
      assert.deepEqual(fixture.snapshot(), { state: scenario.next, issue: null });
    });
  }
});

test('delayed retry reads never clear later Favorites, Preferences, or Theme write failures', async (t) => {
  for (const scenario of providerScenarios) {
    await t.test(scenario.name, async () => {
      const fixture = createStateCoordinator(scenario, async () => {
        throw new Error('private write detail');
      });
      const retryRead = fixture.coordinator.beginRead();

      assert.equal(await fixture.coordinator.submit(scenario.next), false);
      assert.equal(fixture.applyRead(retryRead), false);
      assert.deepEqual(fixture.snapshot(), {
        state: scenario.initial,
        issue: `${scenario.name}-write-error`,
      });
    });
  }
});

test('a retry read still applies when no newer persistence operation occurred', () => {
  const scenario = providerScenarios[1];
  const fixture = createStateCoordinator(scenario, async () => {});
  const retryRead = fixture.coordinator.beginRead();

  assert.equal(fixture.applyRead(retryRead), true);
  assert.deepEqual(fixture.snapshot(), { state: scenario.staleRead, issue: null });
});
