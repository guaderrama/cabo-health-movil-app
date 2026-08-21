import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDevMiniappNavigation,
  createDevMiniapp,
  getVisibleDevMiniapps,
  isDevMiniappPanelEnabled,
  parseDevMiniappCatalog,
  removeDevMiniapp,
  setDevMiniappActive,
} from '../.test-build/features/devMiniapps/devMiniappCatalog.js';
import {
  readDevMiniapps,
  writeDevMiniapps,
} from '../.test-build/features/devMiniapps/devMiniappStore.js';

const validInput = Object.freeze({
  titleEn: 'Microbiota Guide',
  titleEs: 'Guía de microbiota',
  summaryEn: 'Educational food guide for CaboHealth clients.',
  summaryEs: 'Guía educativa de alimentos para clientes de CaboHealth.',
  url: 'https://cabohealth.org/apps/microbiota-guide/',
  access: 'client',
});

test('a valid CaboHealth app link becomes a local test miniapp', () => {
  assert.deepEqual(createDevMiniapp(validInput, []), {
    ok: true,
    value: {
      id: 'microbiota-guide',
      slug: 'microbiota-guide',
      titleEn: validInput.titleEn,
      titleEs: validInput.titleEs,
      summaryEn: validInput.summaryEn,
      summaryEs: validInput.summaryEs,
      url: validInput.url,
      access: 'client',
      active: true,
    },
  });
});

test('test miniapps reject every URL outside an exact CaboHealth app root', () => {
  for (const url of [
    'http://cabohealth.org/apps/microbiota-guide/',
    'https://evil.example/apps/microbiota-guide/',
    'https://cabohealth.org:443/apps/microbiota-guide/',
    'https://user@cabohealth.org/apps/microbiota-guide/',
    'https://cabohealth.org/apps/microbiota-guide/?preview=1',
    'https://cabohealth.org/apps/microbiota-guide/#secret',
    'https://cabohealth.org/apps/microbiota-guide/page/',
    'https://cabohealth.org/apps/%2e%2e/support/',
    ' https://cabohealth.org/apps/microbiota-guide/',
  ]) {
    assert.deepEqual(createDevMiniapp({ ...validInput, url }, []), {
      ok: false,
      reason: 'Use an unused https://cabohealth.org/apps/name/ link.',
    }, url);
  }
});

test('an existing live CaboHealth miniapp URL can be reused for an immediate test card', () => {
  const result = createDevMiniapp({
    ...validInput,
    url: 'https://cabohealth.org/apps/healthy-recipes/',
  }, []);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.id, 'healthy-recipes');
});

test('test miniapps require complete bilingual copy and a known access level', () => {
  for (const input of [
    { ...validInput, titleEn: '   ' },
    { ...validInput, titleEs: '' },
    { ...validInput, summaryEn: '' },
    { ...validInput, summaryEs: '' },
    { ...validInput, access: 'staff' },
  ]) {
    assert.deepEqual(createDevMiniapp(input, []), {
      ok: false,
      reason: 'Complete both languages and choose Public or Clients.',
    });
  }
});

test('the local test catalog has a small fixed capacity', () => {
  const existing = Array.from({ length: 12 }, (_, index) => ({
    id: `test-${index}`,
    slug: `test-${index}`,
    titleEn: `Test ${index}`,
    titleEs: `Prueba ${index}`,
    summaryEn: 'Temporary test.',
    summaryEs: 'Prueba temporal.',
    url: `https://cabohealth.org/apps/test-${index}/`,
    access: 'public',
    active: true,
  }));
  assert.deepEqual(createDevMiniapp(validInput, existing), {
    ok: false,
    reason: 'The test catalog can contain up to 12 miniapps.',
  });
});

test('the private test panel is unavailable in production builds', () => {
  assert.equal(isDevMiniappPanelEnabled(false), false);
  assert.equal(isDevMiniappPanelEnabled(true), true);
});

test('the test catalog can deactivate, reactivate, and remove a miniapp', () => {
  const created = createDevMiniapp(validInput, []);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const disabled = setDevMiniappActive([created.value], created.value.id, false);
  assert.deepEqual(getVisibleDevMiniapps(disabled), []);
  assert.deepEqual(getVisibleDevMiniapps(
    setDevMiniappActive(disabled, created.value.id, true),
  ), [{ ...created.value, active: true }]);
  assert.deepEqual(removeDevMiniapp(disabled, created.value.id), []);
});

test('stored test miniapps are parsed fail-closed', () => {
  const created = createDevMiniapp(validInput, []);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.deepEqual(
    parseDevMiniappCatalog(JSON.stringify([{ ...created.value, active: false }])),
    [{ ...created.value, active: false }],
  );

  for (const stored of [
    '{',
    JSON.stringify([{ ...created.value, url: 'https://evil.example/' }]),
    JSON.stringify([{ ...created.value, unexpected: true }]),
    JSON.stringify([created.value, created.value]),
  ]) {
    assert.throws(() => parseDevMiniappCatalog(stored), /Invalid test miniapp catalog/u);
  }
});

test('production builds never read or write the private test catalog', async () => {
  const effects = [];
  const storage = {
    getItem: async () => { effects.push('read'); return null; },
    setItem: async () => { effects.push('write'); },
  };

  assert.deepEqual(await readDevMiniapps(storage, false), []);
  await writeDevMiniapps(storage, false, []);
  assert.deepEqual(effects, []);
});

test('development builds persist and reload only a valid private test catalog', async () => {
  let stored = null;
  const storage = {
    getItem: async () => stored,
    setItem: async (_key, value) => { stored = value; },
  };
  const created = createDevMiniapp(validInput, []);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  await writeDevMiniapps(storage, true, [created.value]);
  assert.deepEqual(await readDevMiniapps(storage, true), [created.value]);
});

test('a test WebView stays inside the selected CaboHealth miniapp path', () => {
  const selected = validInput.url;
  assert.equal(classifyDevMiniappNavigation(selected, selected), true);
  assert.equal(classifyDevMiniappNavigation(
    selected,
    'https://cabohealth.org/apps/microbiota-guide/foods/#fiber',
  ), true);

  for (const url of [
    'https://cabohealth.org/apps/healthy-recipes/',
    'https://cabohealth.org/apps/microbiota-guide/?preview=1',
    'https://evil.example/apps/microbiota-guide/',
    'https://cabohealth.org/apps/microbiota-guide/%2e%2e/support/',
    'mailto:ivan@example.com',
  ]) {
    assert.equal(classifyDevMiniappNavigation(selected, url), false, url);
  }
});
