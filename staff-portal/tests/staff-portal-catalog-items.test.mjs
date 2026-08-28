import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createCatalogItemModel,
  createCatalogItemGateway,
  validateCatalogItemInput,
} from '../.test-build/domain/catalogItems.js';
import { parseSafeCatalogUrl } from '../.test-build/domain/catalogUrlPolicy.js';
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

const urlCases = JSON.parse(await readFile(
  resolve(process.cwd(), '../tests/fixtures/external-https-url-cases.json'),
  'utf8',
));

test('staff URL validation exactly matches the shared external HTTPS fixture', () => {
  for (const fixture of urlCases.accepted) {
    assert.deepEqual(parseSafeCatalogUrl(fixture.input), {
      kind: fixture.kind,
      ...(fixture.id ? { id: fixture.id } : {}),
      url: fixture.canonical,
    }, fixture.input);
  }
  for (const input of urlCases.rejected) {
    assert.equal(parseSafeCatalogUrl(input), null, input);
  }
});

test('accepts the same safe external HTTPS destination as Public and VIP', () => {
  const base = {
    active: true,
    icon: 'wellness',
    summary: { en: 'Rest and recovery guidance.', 'es-MX': 'Guía de descanso y recuperación.' },
    title: { en: 'Recovery', 'es-MX': 'Recuperación' },
    url: 'https://www.eightsleep.com/mx/',
  };

  for (const access of ['public', 'clients']) {
    const parsed = validateCatalogItemInput({ ...base, access });
    assert.equal(parsed.url, 'https://www.eightsleep.com/mx/');
  }
});

test('canonicalizes a safe external URL for creation without changing the admin request schema', async () => {
  const calls = [];
  const externalItem = {
    ...catalogItem,
    id: 'external-0123456789abcdef0123456789abcdef',
    url: 'https://example.org/a@b?owner=@ivan',
  };
  const gateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'production',
      permissions: ['client_resource_publish'],
    }),
    transport: async (name, payload) => {
      calls.push({ name, payload });
      return { item: externalItem };
    },
  });

  await gateway.create({
    access: externalItem.access,
    active: externalItem.active,
    icon: externalItem.icon,
    summary: externalItem.summary,
    title: externalItem.title,
    url: 'https://example.org:443/a@b?owner=@ivan',
  });

  assert.deepEqual(Object.keys(calls[0].payload).sort(), ['item', 'requestId']);
  assert.deepEqual(Object.keys(calls[0].payload.item).sort(), [
    'access', 'active', 'icon', 'summary', 'title', 'url',
  ]);
  assert.equal(calls[0].payload.item.url, externalItem.url);
  assert.equal('destinationKind' in calls[0].payload.item, false);
});

test('parses canonical opaque external admin records but rejects URL and ID class mismatches', async () => {
  const ownerSession = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const externalItem = {
    ...catalogItem,
    id: 'external-0123456789abcdef0123456789abcdef',
    url: 'https://www.eightsleep.com/mx/',
  };
  const gatewayFor = (item) => createCatalogItemGateway({
    session: ownerSession,
    transport: async () => ({ items: [item] }),
  });

  const listed = await gatewayFor(externalItem).list();
  assert.match(listed[0].id, /^external-[0-9a-f]{32}$/u);
  assert.equal('destinationKind' in listed[0], false);

  await assert.rejects(
    gatewayFor({ ...externalItem, id: 'third-party-link' }).list(),
    /catalog_item_response_invalid/u,
  );
  await assert.rejects(
    gatewayFor({ ...catalogItem, id: externalItem.id }).list(),
    /catalog_item_response_invalid/u,
  );
  await assert.rejects(
    gatewayFor({
      ...catalogItem,
      id: externalItem.id,
      url: `https://cabohealth.org/apps/${externalItem.id}/`,
    }).list(),
    /catalog_item_response_invalid/u,
  );
  await assert.rejects(
    gatewayFor({ ...externalItem, url: 'https://www.eightsleep.com:443/mx/' }).list(),
    /catalog_item_response_invalid/u,
  );
});

test('an edit cannot replace the stored destination or transmit a mutation', async () => {
  const transportCalls = [];
  const gateway = {
    async list() { return [catalogItem]; },
    async create() { throw new Error('unexpected_create'); },
    async update(...args) {
      transportCalls.push(args);
      throw new Error('unexpected_update');
    },
    async setActive() { throw new Error('unexpected_set_active'); },
    async delete() { throw new Error('unexpected_delete'); },
  };
  const model = createCatalogItemModel(gateway);
  await model.load();

  await assert.rejects(model.update(catalogItem.id, catalogItem.revision, {
    access: catalogItem.access,
    icon: catalogItem.icon,
    summary: catalogItem.summary,
    title: catalogItem.title,
    url: 'https://example.org/replacement/',
  }), /catalog_item_url_immutable/u);
  assert.equal(transportCalls.length, 0);
});

test('VIP commercial route checks are internal-only while teaser secrecy applies to external links', () => {
  const externalVip = {
    access: 'clients',
    active: true,
    icon: 'wellness',
    summary: { en: 'Rest and recovery guidance.', 'es-MX': 'Guía de descanso y recuperación.' },
    title: { en: 'Recovery', 'es-MX': 'Recuperación' },
    url: 'https://example.org/pricing/',
  };

  assert.equal(validateCatalogItemInput(externalVip).url, externalVip.url);
  assert.throws(() => validateCatalogItemInput({
    ...externalVip,
    summary: { ...externalVip.summary, en: 'Membership is USD 99' },
  }), /catalog_item_text_invalid/u);
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

test('owner can list unsafe legacy client copy, deactivate it, and repair it', async () => {
  const calls = [];
  let current = Object.freeze({
    ...catalogItem,
    access: 'clients',
    id: 'vip-library',
    summary: Object.freeze({
      en: 'Open /apps/vip-library/launch/ after access.',
      'es-MX': 'Abre /apps/vip-library/launch/ después del acceso.',
    }),
    title: Object.freeze({ en: 'VIP Library', 'es-MX': 'Biblioteca VIP' }),
    url: 'https://cabohealth.org/apps/vip-library/',
  });
  const session = parseServerStaffSession({
    scope: 'production',
    permissions: ['client_resource_publish'],
  });
  const gateway = createCatalogItemGateway({
    session,
    transport: async (name, payload) => {
      calls.push(name);
      if (name === 'adminListCatalogItems') return { items: [current] };
      if (name === 'adminSetCatalogItemActive') {
        current = Object.freeze({ ...current, active: payload.active, revision: 2 });
        return { item: current };
      }
      if (name === 'adminUpdateCatalogItem') {
        current = Object.freeze({ ...current, ...payload.item, revision: 3 });
        return { item: current };
      }
      return { deleted: true };
    },
  });
  const repairedDetails = {
    access: 'clients',
    icon: current.icon,
    summary: { en: 'Tailored wellness guidance.', 'es-MX': 'Orientación de bienestar personalizada.' },
    title: current.title,
    url: current.url,
  };

  assert.deepEqual(await gateway.list(), [current]);
  assert.equal((await gateway.setActive(current.id, 1, false)).active, false);
  assert.deepEqual((await gateway.update(current.id, 2, repairedDetails)).summary, repairedDetails.summary);
  await gateway.delete(current.id, 3);
  assert.deepEqual(calls, [
    'adminListCatalogItems',
    'adminSetCatalogItemActive',
    'adminUpdateCatalogItem',
    'adminDeleteCatalogItem',
  ]);
});

test('owner can list, deactivate, and delete a legacy client item with a newly restricted id', async () => {
  const calls = [];
  const id = 'ch-abcdef01-23456789-a1b2c3d4-e5f60718';
  let current = Object.freeze({
    ...catalogItem,
    access: 'clients',
    id,
    url: `https://cabohealth.org/apps/${id}/`,
  });
  const gateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'production',
      permissions: ['client_resource_publish'],
    }),
    transport: async (name, payload) => {
      calls.push(name);
      if (name === 'adminListCatalogItems') return { items: [current] };
      if (name === 'adminSetCatalogItemActive') {
        current = Object.freeze({ ...current, active: payload.active, revision: 2 });
        return { item: current };
      }
      return { deleted: true };
    },
  });

  assert.deepEqual(await gateway.list(), [current]);
  assert.equal((await gateway.setActive(id, 1, false)).active, false);
  await gateway.delete(id, 2);
  assert.deepEqual(calls, [
    'adminListCatalogItems',
    'adminSetCatalogItemActive',
    'adminDeleteCatalogItem',
  ]);
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

test('client teaser copy rejects sensitive launch details without banning benign private wording', () => {
  const base = {
    access: 'clients',
    active: true,
    icon: 'wellness',
    summary: { en: 'Members-only wellness guidance.', 'es-MX': 'Orientación de bienestar para clientes.' },
    title: { en: 'Private VIP Test', 'es-MX': 'Prueba VIP privada' },
    url: 'https://cabohealth.org/apps/vip-preview/',
  };
  const sensitiveCopy = [
    ['https URL', 'Open https://cabohealth.org/apps/client-resources/launch/'],
    ['mailto URI', 'Email mailto:vip@example.test'],
    ['tel URI', 'Call tel:+526241234567'],
    ['javascript URI', 'Run javascript:alert(1)'],
    ['custom URI', 'Open custom+vip:member-preview'],
    ['relative API path', 'Call api/client-preview'],
    ['relative broker path', 'Continue at broker/session'],
    ['relative client resources path', 'Open client-resources/launch after access'],
    ['relative launch path', 'Open launch/session after access'],
    ['arbitrary relative route', 'Open vip-library/launch after access'],
    ['App Review relative route', 'Open app-review/launch after access'],
    ['relative client resources query', 'Continue at client-resources?token=abc'],
    ['App Review relative query', 'Continue at app-review?token=abc'],
    ['one-letter URI', 'Open x:private-token'],
    ['bare domain', 'Visit www.example.com/vip'],
    ['CaboHealth bare domain', 'Visit cabohealth.org/member'],
    ['bare domain before punctuation', 'Learn more at www.cabohealth.org.'],
    ['IP host', 'Open 192.168.0.1:8080/vip'],
    ['bracketed IPv6 loopback', 'Connect to [::1]'],
    ['bare IPv6 loopback', 'Connect to ::1'],
    ['IPv6 unspecified', 'Connect to [::]'],
    ['full IPv6 loopback', 'Connect to 0:0:0:0:0:0:0:1'],
    ['full IPv6 unspecified', 'Connect to [0:0:0:0:0:0:0:0]'],
    ['private IPv6', 'Connect to fd00::1'],
    ['link-local IPv6', 'Connect to fe80::1'],
    ['apps path', 'Open /apps/client-resources/launch/'],
    ['API path', 'Call /api/client-preview'],
    ['private path', 'Read private/production/catalog.json'],
    ['private infrastructure path', 'Read /_private/client-catalog/'],
    ['absolute home path', 'Read /Users/staff/catalog.json'],
    ['absolute root path', 'Read /root/catalog'],
    ['absolute usr path', 'Read /usr/local/catalog'],
    ['absolute Library path', 'Read /Library/CaboHealth/catalog'],
    ['Windows home path', 'Read C:\\Users\\staff\\catalog'],
    ['Windows private path', 'Read \\private\\catalog'],
    ['arbitrary Windows absolute path', 'Read C:\\deploy\\vip.json'],
    ['arbitrary POSIX absolute path', 'Read /secrets/client.json'],
    ['mounted absolute path', 'Read /Volumes/Private/client.json'],
    ['CH credential', 'Code CH-00112233-44556677-8899AABB-CCDDEEFF'],
    ['AR credential with Unicode separators', 'Code AR 00112233‐44556677‑8899AABB−CCDDEEFF'],
    ['credential with interleaved separators', 'Code CH A B C D E F 0 1 2 3 4 5 6 7 8 9 A B C D E F 0 1 2 3 4 5 6 7 8 9'],
    ['currency symbol', '€49 membership'],
    ['currency code', 'Membership is MXN 1,250'],
    ['currency amount word', 'Membership is 99 dollars'],
    ['Spanish currency amount word', 'Disponible por 1,500 pesos'],
    ['rial amount', 'Available for 99 rials'],
    ['krone amount', 'Available for 99 krone'],
    ['quetzal amount', 'Available for 99 quetzal'],
    ['soles amount', 'Available for 99 soles'],
    ['shilling amount', 'Available for 99 shillings'],
    ['naira amount', 'Available for 99 naira'],
    ['cedi amount', 'Available for 99 cedis'],
    ['boliviano amount', 'Disponible por 99 bolivianos'],
    ['colones amount', 'Disponible por 99 colones'],
    ['contextual pounds price', 'Available for 99 pounds'],
    ['contextual libras price', 'Disponible por 99 libras'],
    ['contextual dinars price', 'Available for 99 dinars'],
    ['contextual quetzales price', 'Disponible por 99 quetzales'],
    ['Brazilian real code', 'Available for 99 BRL'],
    ['Qatari riyal code', 'Available for 99 QAR'],
    ['lowercase Qatari riyal code with amount', 'Membership 99 qar'],
    ['lowercase West African franc code with amount', 'Membership 99 xof'],
    ['standalone West African franc code', 'Membership currency: XOF'],
    ['Kuwaiti dinar code', 'Membership 99 KWD'],
    ['Bahraini dinar code first', 'BHD 20 membership'],
    ['Brazilian real name', 'Disponible por 1,500 reales'],
    ['price wording', 'Special price available'],
    ['Spanish price wording', 'Consulta el precio VIP'],
    ['monthly cadence', 'Membership billed per month'],
    ['Spanish monthly cadence', 'Membresía cobrada por mes'],
    ['monthly membership', 'Monthly membership'],
    ['Spanish monthly membership', 'Membresía mensual'],
    ['Spanish monthly benefits', 'Beneficios mensuales'],
    ['membership', 'Membership available'],
    ['subscription', 'Subscribe for access'],
    ['purchase', 'Purchase access'],
    ['buy', 'Buy access'],
    ['payment', 'Payment required'],
    ['paid membership', 'Paid membership'],
    ['Spanish subscription', 'Suscripción disponible'],
    ['Spanish purchase', 'Comprar acceso'],
    ['Spanish payment', 'Pago requerido'],
    ['Spanish pay', 'Pagar para acceder'],
    ['checkout', 'Checkout available'],
    ['billing', 'Billing available'],
    ['billed', 'Billed annually'],
    ['charge', 'No charge for access'],
    ['sale', 'Sale available'],
    ['sales', 'Sales available'],
    ['for sale', 'Resource for sale'],
    ['IAP', 'IAP available'],
    ['IAP enabled', 'IAP enabled'],
    ['free access', 'Free VIP access'],
    ['free resource access', 'Free resource access'],
    ['access is free', 'Access is free'],
    ['complimentary access', 'Complimentary client access'],
    ['Spanish free access', 'Acceso gratis'],
    ['Spanish charge', 'Cobro anual'],
    ['Spanish sale', 'Venta disponible'],
    ['Spanish sales', 'Ventas disponibles'],
    ['Spanish billing', 'Facturación disponible'],
    ['zero-width formatting', 'VIP\u200B access'],
    ['bidi formatting', 'VIP\u202E access'],
    ['Unicode format control', 'VIP\u061C access'],
  ];

  assert.deepEqual(validateCatalogItemInput(base), base);
  for (const [label, copy] of sensitiveCopy) {
    assert.throws(() => validateCatalogItemInput({
      ...base,
      title: { ...base.title, en: copy },
    }), /catalog_item_text_invalid/u, `${label} in title`);
    assert.throws(() => validateCatalogItemInput({
      ...base,
      summary: { ...base.summary, 'es-MX': copy },
    }), /catalog_item_text_invalid/u, `${label} in summary`);
    assert.equal(validateCatalogItemInput({
      ...base,
      access: 'public',
      title: { ...base.title, en: copy },
    }).title.en, copy, `${label} remains valid for public copy`);
  }
});

test('client teaser copy allows clinical cadence and weight language that is not pricing', () => {
  const input = {
    access: 'clients',
    active: true,
    icon: 'wellness',
    summary: {
      en: 'CHF Guide for CAD prevention, CRC screening, INR monitoring, and care related to SLE, SLL, or STD. GHS reference. Available for 10 minutes per day; use 10 min at 100 bpm for up to 10 hrs and lose 10 pounds safely. Client access is VIP.',
      'es-MX': 'Disponible por 10 minutos al día; entrena con pesos libres una vez por semana.',
    },
    title: { en: 'Private VIP Test: AED Training', 'es-MX': 'Prueba VIP privada' },
    url: 'https://cabohealth.org/apps/vip-preview/',
  };

  assert.deepEqual(validateCatalogItemInput(input), input);

  const freeLanguageInput = {
    ...input,
    summary: {
      en: 'Free weights for VIP clients and sugar-free nutrition support clinical care.',
      'es-MX': 'Consejos para cuando sales a caminar. Pesos libres para clientes VIP apoyan el cuidado clínico.',
    },
    title: { en: 'Free weights guide', 'es-MX': 'Guía de pesos libres' },
    url: 'https://cabohealth.org/apps/free-weights-guide/',
  };
  assert.deepEqual(validateCatalogItemInput(freeLanguageInput), freeLanguageInput);

  const freeWeightResourceInput = {
    ...input,
    summary: {
      en: 'A resource about free weights. Try 10 minutes of 10 real-world exercises. Ratios 1:2 and times 10:30 or 10:30:00 support clinical guidance.',
      'es-MX': 'Un recurso sobre ejercicios con pesos libres.',
    },
    title: { en: 'Free weights resource', 'es-MX': 'Recurso de fuerza' },
    url: 'https://cabohealth.org/apps/strength-training-guide/',
  };
  assert.deepEqual(validateCatalogItemInput(freeWeightResourceInput), freeWeightResourceInput);

  const iapClinicalInput = {
    ...input,
    summary: {
      en: 'IAP monitoring guide for intra-abdominal pressure.',
      'es-MX': 'Guía de monitoreo de presión intraabdominal.',
    },
    title: { en: 'IAP Monitoring', 'es-MX': 'Monitoreo de presión' },
    url: 'https://cabohealth.org/apps/pressure-monitoring/',
  };
  assert.deepEqual(validateCatalogItemInput(iapClinicalInput), iapClinicalInput);
});

test('client catalog ids cannot encode credentials or commercial metadata', () => {
  const base = {
    access: 'clients',
    active: true,
    icon: 'featured',
    summary: { en: 'A tailored wellness experience.', 'es-MX': 'Una experiencia de bienestar personalizada.' },
    title: { en: 'VIP Library', 'es-MX': 'Biblioteca VIP' },
  };
  const restrictedIds = [
    'ch-abcdef01-23456789-a1b2c3d4-e5f60718',
    'ar-01234567-89abcdef-01234567-89abcdef',
    'ar0123456789abcdef0123456789abcdef',
    'ch-abcd-ef01-2345-6789-a1b2-c3d4-e5f6-0718',
    'vip-price',
    'pricing-vip',
    'vip-precio',
    'care-cost',
    'costo-care',
    'membership-fee',
    'tarifa-vip',
    'monthly-vip',
    'vip-mensual',
    'vip-99-brl',
    'vip-inr-1500',
    'vip-99-qar',
    'vip-kwd-1500',
    'vip-bhd-20',
    'vip-omr-9',
    'vip-99-xof',
    'vip-99-dollars',
    'vip-dollars-99',
    'vip-99-pesos',
    'vip-99-euros',
    'vip-99-rials',
    'vip-99-krone',
    'vip-99-quetzal',
    'vip-99-soles',
    'vip-99-shillings',
    'vip-99-naira',
    'vip-99-cedis',
    'vip-99-bolivianos',
    'vip-99-colones',
    'vip-99usd',
    'vip-usd99',
    'vip-99dollars',
    'vip-dollars99',
    'vip-price99',
    'vip-99price',
    'vip-monthly99',
    'vip-checkout99',
    'vip-99-pen',
    'vip-try-1500',
    'vip-currency-xof',
    'vip-moneda-mxn',
    'vip-ngn-membership',
    'mxn-membership',
    'vip-subscription',
    'vip-subscribed',
    'vip-purchasing',
    'vip-buy-access',
    'vip-buys',
    'vip-buying',
    'vip-payment',
    'membresia-vip',
    'vip-suscripcion',
    'vip-pago',
    'vip-checkout',
    'vip-billing',
    'vip-billed',
    'vip-charge',
    'vip-charging',
    'vip-sale',
    'vip-sales',
    'vip-cobro',
    'vip-venta',
    'vip-facturacion',
    'iap-purchase',
    'iap-payment',
    'iap-checkout',
    'iap-available',
    'iap-enabled',
    'available-iap',
    'enabled-iap',
    'vip-free-access',
    'resource-free',
  ];

  for (const id of restrictedIds) {
    const url = `https://cabohealth.org/apps/${id}/`;
    assert.throws(() => validateCatalogItemInput({ ...base, url }), /catalog_item_url_invalid/u, id);
    assert.equal(validateCatalogItemInput({ ...base, access: 'public', url }).url, url, `${id} remains valid for public access`);
  }
  for (const id of [
    'private-vip-test',
    'priceless-guide',
    'costume-guide',
    'try-this-guide',
    'pen-and-paper',
    'inr-guide',
    'aed-training',
    'vip-usd',
    'free-weights-guide',
    'sugar-free-guide',
    'vip-free-weights-guide',
    'client-free-weights-guide',
    'vip-gratis',
    'client-complimentary',
    'iap-monitoring',
    'vip-iap',
    'lose-10-pounds',
    '10-pesos-libres',
    '10pesos-libres',
    'priceless99-guide',
    'costume99-guide',
    '10min-guide',
    '100bpm-guide',
    '10hrs-guide',
    'colon-care-guide',
    'sol-care-guide',
    'real-world-guide',
    '10-real-world-exercises',
  ]) {
    const url = `https://cabohealth.org/apps/${id}/`;
    assert.equal(validateCatalogItemInput({ ...base, url }).url, url, id);
  }
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
    'https://cabohealth.org/apps/review-sandbox-app-review-sample-v1/',
    'https://cabohealth.org/apps/review-sandbox-future-sample/',
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

test('Staff permanently rejects historical App Review slugs before publication', () => {
  const base = {
    access: 'public',
    active: true,
    icon: 'guide',
    summary: { en: 'Summary', 'es-MX': 'Descripción' },
    title: { en: 'Title', 'es-MX': 'Título' },
  };

  for (const id of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    assert.throws(() => validateCatalogItemInput({
      ...base,
      url: `https://cabohealth.org/apps/${id}/`,
    }), /catalog_item_url_invalid/u, id);
  }
});

test('Staff never sends a mutation for a permanently retired catalog id', async () => {
  let calls = 0;
  const gateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'production',
      permissions: ['client_resource_publish'],
    }),
    transport: async () => {
      calls++;
      return { item: catalogItem };
    },
  });

  for (const id of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    await assert.rejects(gateway.setActive(id, 1, true), /catalog_item_identity_invalid/u, id);
  }
  assert.equal(calls, 0);
});

test('Staff rejects every review-sandbox mutation before calling the transport', async () => {
  let calls = 0;
  const gateway = createCatalogItemGateway({
    session: parseServerStaffSession({
      scope: 'production',
      permissions: ['client_resource_publish'],
    }),
    transport: async (name) => {
      calls++;
      return name === 'adminDeleteCatalogItem' ? { deleted: true } : { item: catalogItem };
    },
  });
  const id = 'review-sandbox-future-sample';
  const details = {
    access: catalogItem.access,
    icon: catalogItem.icon,
    summary: catalogItem.summary,
    title: catalogItem.title,
    url: catalogItem.url,
  };

  await assert.rejects(gateway.setActive(id, 1, true), /catalog_item_identity_invalid/u);
  await assert.rejects(gateway.update(id, 1, details), /catalog_item_identity_invalid/u);
  await assert.rejects(gateway.delete(id, 1), /catalog_item_identity_invalid/u);
  assert.equal(calls, 0);
});

test('Staff rejects a catalog response containing a permanently retired id', async () => {
  for (const id of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    const gateway = createCatalogItemGateway({
      session: parseServerStaffSession({
        scope: 'production',
        permissions: ['client_resource_publish'],
      }),
      transport: async () => ({ items: [{
        ...catalogItem,
        id,
        url: `https://cabohealth.org/apps/${id}/`,
      }] }),
    });
    await assert.rejects(gateway.list(), /catalog_item_response_invalid/u, id);
  }
});
