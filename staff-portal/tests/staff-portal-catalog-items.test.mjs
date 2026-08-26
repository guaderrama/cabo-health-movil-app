import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatalogItemModel,
  createCatalogItemGateway,
  validateCatalogItemInput,
} from '../.test-build/domain/catalogItems.js';
import {
  parseServerStaffSession,
} from '../.test-build/domain/staffGateway.js';

const catalogItem = Object.freeze({
  access: 'public',
  active: true,
  createdAtMs: 1_800_000_000_000,
  icon: 'guide',
  id: 'clinic-guide',
  revision: 1,
  summary: Object.freeze({
    en: 'Practical CaboHealth guidance.',
    'es-MX': 'Orientación práctica de CaboHealth.',
  }),
  title: Object.freeze({ en: 'Clinic guide', 'es-MX': 'Guía clínica' }),
  updatedAtMs: 1_800_000_000_000,
  url: 'https://cabohealth.org/apps/clinic-guide/',
});

test('an authorized production owner lists the real catalog through the exact callable', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gateway = createCatalogItemGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { items: [catalogItem] };
    },
  });

  assert.deepEqual(await gateway.list(), [catalogItem]);
  assert.deepEqual(calls, [{ name: 'adminListCatalogItems', payload: {} }]);
});

test('owner creates an active miniapp with one opaque idempotency key', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gateway = createCatalogItemGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { item: catalogItem };
    },
  });
  const input = {
    access: catalogItem.access,
    active: catalogItem.active,
    icon: catalogItem.icon,
    summary: catalogItem.summary,
    title: catalogItem.title,
    url: catalogItem.url,
  };

  assert.deepEqual(await gateway.create(input), catalogItem);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'adminCreateCatalogItem');
  assert.deepEqual(calls[0].payload.item, input);
  assert.match(calls[0].payload.requestId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ['item', 'requestId']);
});

test('owner edits bilingual details with the current optimistic revision', async () => {
  const calls = [];
  const updated = {
    ...catalogItem,
    revision: 2,
    title: { en: 'Updated guide', 'es-MX': 'Guía actualizada' },
  };
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gateway = createCatalogItemGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { item: updated };
    },
  });
  const details = {
    access: updated.access,
    icon: updated.icon,
    summary: updated.summary,
    title: updated.title,
    url: updated.url,
  };

  assert.deepEqual(await gateway.update(catalogItem.id, 1, details), updated);
  assert.equal(calls[0].name, 'adminUpdateCatalogItem');
  assert.deepEqual(calls[0].payload.item, details);
  assert.equal(calls[0].payload.id, 'clinic-guide');
  assert.equal(calls[0].payload.revision, 1);
  assert.match(calls[0].payload.requestId, /^[0-9a-f-]{36}$/u);
});

test('owner deactivates and reactivates a miniapp without changing its details', async () => {
  const calls = [];
  const inactive = { ...catalogItem, active: false, revision: 2 };
  const activeAgain = { ...catalogItem, revision: 3 };
  let response = inactive;
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gateway = createCatalogItemGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { item: response };
    },
  });

  assert.deepEqual(await gateway.setActive('clinic-guide', 1, false), inactive);
  response = activeAgain;
  assert.deepEqual(await gateway.setActive('clinic-guide', 2, true), activeAgain);
  assert.deepEqual(calls.map(({ name, payload }) => ({
    name,
    active: payload.active,
    id: payload.id,
    revision: payload.revision,
  })), [
    { name: 'adminSetCatalogItemActive', active: false, id: 'clinic-guide', revision: 1 },
    { name: 'adminSetCatalogItemActive', active: true, id: 'clinic-guide', revision: 2 },
  ]);
  assert.notEqual(calls[0].payload.requestId, calls[1].payload.requestId);
});

test('owner permanently deletes one selected miniapp at its current revision', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gateway = createCatalogItemGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { deleted: true };
    },
  });

  await gateway.delete('clinic-guide', 3);

  assert.equal(calls[0].name, 'adminDeleteCatalogItem');
  assert.equal(calls[0].payload.id, 'clinic-guide');
  assert.equal(calls[0].payload.revision, 3);
  assert.match(calls[0].payload.requestId, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ['id', 'requestId', 'revision']);
});

test('the catalog model keeps owner-visible state current after every successful mutation', async () => {
  let items = [catalogItem];
  const gateway = {
    async list() { return items; },
    async create(input) {
      const created = { ...catalogItem, ...input, id: 'healthy-recipes' };
      items = [...items, created];
      return created;
    },
    async update(id, revision, details) {
      const updated = { ...items.find((item) => item.id === id), ...details, revision: revision + 1 };
      items = items.map((item) => item.id === id ? updated : item);
      return updated;
    },
    async setActive(id, revision, active) {
      const updated = { ...items.find((item) => item.id === id), active, revision: revision + 1 };
      items = items.map((item) => item.id === id ? updated : item);
      return updated;
    },
    async delete(id) { items = items.filter((item) => item.id !== id); },
  };
  const model = createCatalogItemModel(gateway);

  await model.load();
  const created = await model.create({
    access: 'public',
    active: true,
    icon: 'recipes',
    summary: { en: 'Healthy recipes.', 'es-MX': 'Recetas saludables.' },
    title: { en: 'Healthy recipes', 'es-MX': 'Recetas saludables' },
    url: 'https://cabohealth.org/apps/healthy-recipes/',
  });
  const edited = await model.update(created.id, created.revision, {
    access: created.access,
    icon: created.icon,
    summary: created.summary,
    title: { en: 'Everyday recipes', 'es-MX': 'Recetas para cada día' },
    url: created.url,
  });
  const inactive = await model.setActive(edited.id, edited.revision, false);
  await model.delete(inactive.id, inactive.revision);

  assert.deepEqual(model.getSnapshot().items, [catalogItem]);
});

test('a lost-network retry reuses the same idempotency key for the same mutation attempt', async () => {
  const calls = [];
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gateway = createCatalogItemGateway({
    session,
    transport: async (name, payload) => {
      calls.push({ name, payload });
      if (calls.length === 1) throw new TypeError('Failed to fetch');
      return { item: catalogItem };
    },
  });

  await gateway.setActive(catalogItem.id, catalogItem.revision, true);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
});

test('catalog administration fails closed for untrusted responses and every non-owner session', async () => {
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { items: [] };
  };
  const reviewGateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'review-sandbox',
      permissions: ['client_resource_publish'],
    }),
    transport,
  });
  const codesGateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'production',
      permissions: ['client_codes'],
    }),
    transport,
  });

  await assert.rejects(reviewGateway.list(), /staff_capability_unavailable/u);
  await assert.rejects(codesGateway.list(), /staff_capability_unavailable/u);
  assert.equal(calls, 0);

  const ownerSession = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const extended = createCatalogItemGateway({
    session: ownerSession,
    transport: async () => ({ items: [{ ...catalogItem, published: true }] }),
  });
  const external = createCatalogItemGateway({
    session: ownerSession,
    transport: async () => ({ items: [{
      ...catalogItem,
      id: 'external',
      url: 'https://example.org/apps/external/',
    }] }),
  });
  await assert.rejects(extended.list(), /catalog_item_response_invalid/u);
  await assert.rejects(external.list(), /catalog_item_response_invalid/u);
});

test('browser input validation mirrors the server title and summary limits', () => {
  const base = {
    access: 'clients',
    active: true,
    icon: 'wellness',
    summary: { en: 'S'.repeat(240), 'es-MX': 'R'.repeat(240) },
    title: { en: 'T'.repeat(80), 'es-MX': 'N'.repeat(80) },
    url: 'https://cabohealth.org/apps/wellness-guide/',
  };

  assert.deepEqual(validateCatalogItemInput(base), base);
  assert.throws(() => validateCatalogItemInput({
    ...base,
    title: { ...base.title, en: 'T'.repeat(81) },
  }), /catalog_item_text_invalid/u);
  assert.throws(() => validateCatalogItemInput({
    ...base,
    summary: { ...base.summary, en: 'S'.repeat(241) },
  }), /catalog_item_text_invalid/u);
});

test('catalog titles and summaries reject every native-disallowed ASCII control range', async () => {
  const base = {
    access: 'public',
    active: true,
    icon: 'guide',
    summary: { en: 'Summary', 'es-MX': 'Descripción' },
    title: { en: 'Title', 'es-MX': 'Título' },
    url: 'https://cabohealth.org/apps/control-check/',
  };

  for (const control of ['\u0000', '\u001f', '\u007f']) {
    assert.throws(() => validateCatalogItemInput({
      ...base,
      title: { ...base.title, en: `Cabo${control}Health` },
    }), /catalog_item_text_invalid/u);
    assert.throws(() => validateCatalogItemInput({
      ...base,
      summary: { ...base.summary, 'es-MX': `Cabo${control}Health` },
    }), /catalog_item_text_invalid/u);
  }

  const gateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'production',
      permissions: ['client_resource_publish'],
    }),
    transport: async () => ({ items: [{
      ...catalogItem,
      summary: { ...catalogItem.summary, en: 'Line one\nLine two' },
    }] }),
  });
  await assert.rejects(gateway.list(), /catalog_item_response_invalid/u);
});

test('catalog list rejects impossible timestamps, duplicate ids, and more than twelve items', async () => {
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gatewayFor = (items) => createCatalogItemGateway({
    session,
    transport: async () => ({ items }),
  });

  await assert.rejects(gatewayFor([{
    ...catalogItem,
    createdAtMs: catalogItem.updatedAtMs + 1,
  }]).list(), /catalog_item_response_invalid/u);
  await assert.rejects(gatewayFor([catalogItem, catalogItem]).list(), /catalog_item_response_invalid/u);
  await assert.rejects(gatewayFor(Array.from({ length: 13 }, (_, index) => ({
    ...catalogItem,
    id: `guide-${index}`,
    url: `https://cabohealth.org/apps/guide-${index}/`,
  }))).list(), /catalog_item_response_invalid/u);
});

test('miniapp slugs are limited to the native catalog maximum of 64 characters', async () => {
  const slug64 = 'a'.repeat(64);
  const slug65 = 'a'.repeat(65);
  const base = {
    access: 'public',
    active: true,
    icon: 'guide',
    summary: { en: 'Summary', 'es-MX': 'Descripción' },
    title: { en: 'Title', 'es-MX': 'Título' },
  };
  assert.equal(validateCatalogItemInput({
    ...base,
    url: `https://cabohealth.org/apps/${slug64}/`,
  }).url, `https://cabohealth.org/apps/${slug64}/`);
  assert.throws(() => validateCatalogItemInput({
    ...base,
    url: `https://cabohealth.org/apps/${slug65}/`,
  }), /catalog_item_url_invalid/u);

  const gateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'production',
      permissions: ['client_resource_publish'],
    }),
    transport: async () => ({ items: [{
      ...catalogItem,
      id: slug65,
      url: `https://cabohealth.org/apps/${slug65}/`,
    }] }),
  });
  await assert.rejects(gateway.list(), /catalog_item_response_invalid/u);
});

test('catalog route policy reserves infrastructure and keeps the broker root client-only', () => {
  const base = {
    active: true,
    icon: 'guide',
    summary: { en: 'Summary', 'es-MX': 'Descripción' },
    title: { en: 'Title', 'es-MX': 'Título' },
  };
  for (const url of [
    'https://cabohealth.org/apps/app-review/',
    'https://cabohealth.org/apps/shared/',
  ]) {
    assert.throws(() => validateCatalogItemInput({ ...base, access: 'public', url }), /catalog_item_url_invalid/u);
  }
  assert.throws(() => validateCatalogItemInput({
    ...base,
    access: 'public',
    url: 'https://cabohealth.org/apps/client-resources/',
  }), /catalog_item_url_invalid/u);
  assert.equal(validateCatalogItemInput({
    ...base,
    access: 'clients',
    url: 'https://cabohealth.org/apps/client-resources/',
  }).url, 'https://cabohealth.org/apps/client-resources/');
});
