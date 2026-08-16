import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyMiniappNavigation,
  resolvePublicMiniappRouteSlug,
} from '../.test-build/features/launch/navigationPolicy.js';
import {
  getConfirmedPublicContactUrls,
  PUBLIC_CONTACT_URLS,
} from '../.test-build/constants/publicContacts.js';

const selectedSlug = 'healthy-recipes';
const selectedUrl = 'https://cabohealth.org/apps/healthy-recipes/';
const syntheticContacts = [
  'mailto:owner@example.test',
  'tel:+526241234567',
  'https://maps.apple.com/?address=Exact%20Clinic',
  'https://wa.me/526241234567',
];

function classify(url, overrides = {}, contactUrls = []) {
  return classifyMiniappNavigation({
    slug: selectedSlug,
    url,
    platform: 'ios',
    navigationType: 'other',
    isTopFrame: true,
    isPopup: false,
    ...overrides,
  }, contactUrls);
}

test('allows only the selected miniapp exact path prefix in the WebView', () => {
  for (const url of [
    selectedUrl,
    'https://cabohealth.org/apps/healthy-recipes/details/tomato-soup',
    'https://cabohealth.org/apps/healthy-recipes/?lang=es#ingredients',
  ]) {
    assert.deepEqual(classify(url), {
      decision: 'allow-webview',
      reason: 'selected-miniapp-path',
    });
  }
});

test('blocks cross-module, root, legal-as-internal, legacy, and arbitrary same-host paths', () => {
  const cases = [
    ['https://cabohealth.org/apps/clinic-guide/', 'cross-miniapp-path'],
    ['https://cabohealth.org/', 'unapproved-path'],
    ['https://cabohealth.org/app/privacy/', 'external-not-user-initiated'],
    ['https://cabohealth.org/app/gut-health/', 'unapproved-path'],
    ['https://cabohealth.org/anything/', 'unapproved-path'],
  ];

  for (const [url, reason] of cases) {
    assert.deepEqual(classify(url), { decision: 'block', reason });
  }
});

test('rejects unsafe text, relative URLs, malformed URLs, userinfo, and every explicit port', () => {
  const cases = [
    [' https://cabohealth.org/apps/healthy-recipes/', 'unsafe-url-text'],
    ['https://cabohealth.org/apps/healthy-recipes/\n', 'unsafe-url-text'],
    ['https://cabohealth.org/apps\\healthy-recipes/', 'unsafe-url-text'],
    ['/apps/healthy-recipes/', 'relative-url'],
    ['//cabohealth.org/apps/healthy-recipes/', 'relative-url'],
    ['https://%', 'malformed-url'],
    ['https://person@cabohealth.org/apps/healthy-recipes/', 'userinfo-not-allowed'],
    ['https://cabohealth.org:8443/apps/healthy-recipes/', 'port-not-allowed'],
    ['https://cabohealth.org:443/apps/healthy-recipes/', 'port-not-allowed'],
  ];

  for (const [url, reason] of cases) {
    assert.deepEqual(classify(url), { decision: 'block', reason });
  }
});

test('rejects host lookalikes, subdomains, trailing dots, IDNs, and non-HTTPS schemes', () => {
  const cases = [
    ['https://www.cabohealth.org/apps/healthy-recipes/', 'host-not-allowed'],
    ['https://cabohealth.org.example/apps/healthy-recipes/', 'host-not-allowed'],
    ['https://cabohealth.org./apps/healthy-recipes/', 'host-not-allowed'],
    ['https://cabóhealth.org/apps/healthy-recipes/', 'host-not-allowed'],
    ['http://cabohealth.org/apps/healthy-recipes/', 'unsafe-scheme'],
    ['javascript:alert(1)', 'unsafe-scheme'],
    ['data:text/html,unsafe', 'unsafe-scheme'],
    ['file:///tmp/unsafe', 'unsafe-scheme'],
    ['blob:https://cabohealth.org/id', 'unsafe-scheme'],
    ['cabohealth://apps/healthy-recipes', 'unsafe-scheme'],
  ];

  for (const [url, reason] of cases) {
    assert.deepEqual(classify(url), { decision: 'block', reason });
  }
});

test('rejects traversal, encoded separators, and double-encoded path attacks', () => {
  const cases = [
    'https://cabohealth.org/apps/healthy-recipes/../clinic-guide/',
    'https://cabohealth.org/apps/healthy-recipes/%2e%2e/clinic-guide/',
    'https://cabohealth.org/apps/healthy-recipes/%2Fclinic-guide/',
    'https://cabohealth.org/apps/healthy-recipes/%5cclinic-guide/',
    'https://cabohealth.org/apps/healthy-recipes/%252fclinic-guide/',
    'https://cabohealth.org/apps/healthy-recipes/%252e%252e/clinic-guide/',
  ];

  const reasons = [
    'path-traversal',
    'path-traversal',
    'unsafe-path-encoding',
    'unsafe-path-encoding',
    'unsafe-path-encoding',
    'path-traversal',
  ];

  cases.forEach((url, index) => {
    assert.deepEqual(classify(url), { decision: 'block', reason: reasons[index] });
  });
});

test('rejects encoded whitespace and control bytes in paths without interpreting a query as path', () => {
  for (const url of [
    'https://cabohealth.org/apps/healthy-recipes/%00hidden',
    'https://cabohealth.org/apps/healthy-recipes/%0Ahidden',
    'https://cabohealth.org/apps/healthy-recipes/%20hidden',
    'https://cabohealth.org/apps/healthy-recipes/%7fhidden',
  ]) {
    assert.deepEqual(classify(url), {
      decision: 'block',
      reason: 'unsafe-path-encoding',
    });
  }

  assert.deepEqual(
    classify('https://cabohealth.org/apps/healthy-recipes/?q=warm%20soup'),
    { decision: 'allow-webview', reason: 'selected-miniapp-path' },
  );
});

test('opens exact catalog legal destinations only for top-frame iOS clicks', () => {
  const legalUrl = 'https://cabohealth.org/app/privacy/';
  assert.deepEqual(classify(legalUrl, { navigationType: 'click' }), {
    decision: 'open-external',
    reason: 'approved-legal-click',
  });

  for (const overrides of [
    { navigationType: 'other' },
    { navigationType: 'click', isTopFrame: false },
    { navigationType: 'click', platform: 'android' },
  ]) {
    assert.deepEqual(classify(legalUrl, overrides), {
      decision: 'block',
      reason: 'external-not-user-initiated',
    });
  }
});

test('opens each exact confirmed contact only for top-frame iOS clicks without normalization', () => {
  for (const url of syntheticContacts) {
    assert.deepEqual(
      classify(url, { navigationType: 'click' }, syntheticContacts),
      { decision: 'open-external', reason: 'approved-contact-click' },
    );
  }

  for (const url of [
    'MAILTO:owner@example.test',
    'mailto:other@example.test',
    'tel:+526241234568',
    'https://maps.apple.com/?address=Different%20Clinic',
    'https://wa.me/526241234568',
    'https://wa.me/526241234567?text=hello',
  ]) {
    assert.deepEqual(
      classify(url, { navigationType: 'click' }, syntheticContacts),
      { decision: 'block', reason: 'external-not-allowlisted' },
    );
  }
});

test('production owner contact allowlist remains empty while frozen facts are unconfirmed', () => {
  assert.deepEqual(PUBLIC_CONTACT_URLS, []);
  assert.deepEqual(
    classify('mailto:owner@example.test', { navigationType: 'click' }, PUBLIC_CONTACT_URLS),
    { decision: 'block', reason: 'external-not-allowlisted' },
  );
});

test('contact adapter rejects stale values unless the record and each contact source are confirmed', () => {
  const confirmedSource = {
    sourceUrl: 'https://cabohealth.org/source/',
    sourceStatus: 'owner-confirmed-source',
  };
  const facts = {
    status: 'owner-confirmed',
    ownerConfirmedAt: '2026-08-16T18:30:00.000Z',
    facts: {
      publicEmail: { value: 'owner@example.test', ...confirmedSource },
      phone: { value: '+526241234567', ...confirmedSource },
      whatsApp: { value: 'https://wa.me/526241234567', ...confirmedSource },
      address: { value: 'Exact Clinic', ...confirmedSource },
      hours: { value: 'Monday-Friday', ...confirmedSource },
      appleMapsDestination: { value: 'https://maps.apple.com/?address=Exact%20Clinic', ...confirmedSource },
      serviceLanguages: { value: ['English', 'Español'], ...confirmedSource },
    },
  };

  assert.deepEqual(getConfirmedPublicContactUrls({
    ...facts,
    ownerConfirmedAt: 'not-a-timestamp',
  }), []);
  assert.deepEqual(
    getConfirmedPublicContactUrls(facts),
    syntheticContacts,
  );
});

test('contact adapter requires exactly all seven frozen fact keys before deriving URLs', () => {
  const confirmedSource = {
    sourceUrl: 'https://cabohealth.org/source/',
    sourceStatus: 'owner-confirmed-source',
  };
  const completeFacts = {
    publicEmail: { value: 'owner@example.test', ...confirmedSource },
    phone: { value: '+526241234567', ...confirmedSource },
    whatsApp: { value: 'https://wa.me/526241234567', ...confirmedSource },
    address: { value: 'Exact Clinic', ...confirmedSource },
    hours: { value: 'Monday-Friday', ...confirmedSource },
    appleMapsDestination: { value: 'https://maps.apple.com/?address=Exact%20Clinic', ...confirmedSource },
    serviceLanguages: { value: ['English', 'Español'], ...confirmedSource },
  };
  const record = {
    status: 'owner-confirmed',
    ownerConfirmedAt: '2026-08-16T18:30:00.000Z',
    facts: completeFacts,
  };

  for (const omitted of ['address', 'hours', 'serviceLanguages']) {
    assert.deepEqual(getConfirmedPublicContactUrls({
      ...record,
      facts: Object.fromEntries(
        Object.entries(completeFacts).filter(([key]) => key !== omitted),
      ),
    }), [], `missing ${omitted}`);
  }

  assert.deepEqual(getConfirmedPublicContactUrls({
    ...record,
    facts: {
      ...completeFacts,
      extraContact: { value: 'unexpected', ...confirmedSource },
    },
  }), []);
});

test('contact adapter rejects invalid values and every untrusted source URL shape', () => {
  const confirmedSource = {
    sourceUrl: 'https://cabohealth.org/source/',
    sourceStatus: 'owner-confirmed-source',
  };
  const completeFacts = {
    publicEmail: { value: 'owner@example.test', ...confirmedSource },
    phone: { value: '+526241234567', ...confirmedSource },
    whatsApp: { value: 'https://wa.me/526241234567', ...confirmedSource },
    address: { value: 'Exact Clinic', ...confirmedSource },
    hours: { value: 'Monday-Friday', ...confirmedSource },
    appleMapsDestination: { value: 'https://maps.apple.com/?address=Exact%20Clinic', ...confirmedSource },
    serviceLanguages: { value: ['English', 'Español'], ...confirmedSource },
  };
  const record = {
    status: 'owner-confirmed',
    ownerConfirmedAt: '2026-08-16T18:30:00.000Z',
    facts: completeFacts,
  };

  for (const sourceUrl of [
    '',
    'not-a-url',
    'http://cabohealth.org/source/',
    ' https://cabohealth.org/source/',
    'https://cabohealth.org/source/ ',
  ]) {
    assert.deepEqual(getConfirmedPublicContactUrls({
      ...record,
      facts: {
        ...completeFacts,
        address: { ...completeFacts.address, sourceUrl },
      },
    }), [], sourceUrl);
  }

  for (const facts of [
    { ...completeFacts, address: { ...completeFacts.address, value: '   ' } },
    { ...completeFacts, hours: { ...completeFacts.hours, value: '' } },
    { ...completeFacts, serviceLanguages: { ...completeFacts.serviceLanguages, value: [] } },
    { ...completeFacts, serviceLanguages: { ...completeFacts.serviceLanguages, value: ['English', ' '] } },
  ]) {
    assert.deepEqual(getConfirmedPublicContactUrls({ ...record, facts }), []);
  }
});

test('blocks script and redirect attempts to otherwise approved external destinations', () => {
  for (const url of [
    'https://cabohealth.org/app/terms/',
    ...syntheticContacts,
  ]) {
    assert.deepEqual(classify(url, { navigationType: 'other' }, syntheticContacts), {
      decision: 'block',
      reason: 'external-not-user-initiated',
    });
  }
});

test('blocks every popup target before considering its destination', () => {
  for (const url of [
    selectedUrl,
    'https://cabohealth.org/app/support/',
    ...syntheticContacts,
  ]) {
    assert.deepEqual(
      classify(url, { navigationType: 'click', isPopup: true }, syntheticContacts),
      { decision: 'block', reason: 'popup-target' },
    );
  }
});

test('resolves only a single exact approved route slug', () => {
  assert.equal(resolvePublicMiniappRouteSlug('healthy-recipes'), 'healthy-recipes');
  assert.equal(resolvePublicMiniappRouteSlug(undefined), undefined);
  assert.equal(resolvePublicMiniappRouteSlug([]), undefined);
  assert.equal(resolvePublicMiniappRouteSlug(['healthy-recipes']), undefined);
  assert.equal(resolvePublicMiniappRouteSlug('unknown'), undefined);
  assert.equal(resolvePublicMiniappRouteSlug(' healthy-recipes'), undefined);
});
