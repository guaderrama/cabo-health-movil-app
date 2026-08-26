import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPROVED_EDITORIAL_SOURCE_URLS,
  classifyMiniappNavigation,
  resolvePublicMiniappRouteSlug,
  shouldWaitForPublicCatalogRoute,
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
const dynamicMiniapp = {
  slug: 'sun-care',
  canonicalUrl: 'https://cabohealth.org/apps/sun-care/',
  universalLink: 'https://cabohealth.org/apps/sun-care/',
  allowedPathPrefix: '/apps/sun-care/',
  legalUrls: {
    privacy: 'https://cabohealth.org/app/privacy/',
    terms: 'https://cabohealth.org/app/terms/',
    support: 'https://cabohealth.org/app/support/',
    reportContent: 'https://cabohealth.org/app/report-content/',
  },
};

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
    'https://cabohealth.org/apps/healthy-recipes/#main-content',
    'https://cabohealth.org/apps/healthy-recipes/#embedded-en',
    'https://cabohealth.org/apps/healthy-recipes/#embedded-en-reduced',
    'https://cabohealth.org/apps/healthy-recipes/#embedded-es-MX',
    'https://cabohealth.org/apps/healthy-recipes/#embedded-es-MX-reduced',
  ]) {
    assert.deepEqual(classify(url), {
      decision: 'allow-webview',
      reason: 'selected-miniapp-path',
    });
  }
});

test('rejects queries and every fragment outside the frozen root presentation matrix', () => {
  const cases = [
    ['https://cabohealth.org/apps/healthy-recipes/?lang=es', 'query-not-allowed'],
    ['https://cabohealth.org/apps/healthy-recipes/?lang=es#embedded-es-MX', 'query-not-allowed'],
    ['https://cabohealth.org/apps/healthy-recipes/#ingredients', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/#embedded', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/#embedded-EN', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/#embedded-en-suffix', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/#%65mbedded-en', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/#__proto__', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/#constructor', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/#toString', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/details/tomato-soup#embedded-en', 'unapproved-fragment'],
    ['https://cabohealth.org/apps/healthy-recipes/details/tomato-soup#main-content', 'unapproved-fragment'],
  ];

  for (const [url, reason] of cases) {
    assert.deepEqual(classify(url), { decision: 'block', reason }, url);
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

test('rejects encoded whitespace and control bytes in paths and rejects every query', () => {
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
    { decision: 'block', reason: 'query-not-allowed' },
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

test('opens only the exact official editorial citations after an explicit top-frame iOS click', () => {
  for (const [slug, urls] of Object.entries(APPROVED_EDITORIAL_SOURCE_URLS)) {
    for (const url of urls) {
      assert.deepEqual(classify(url, { slug, navigationType: 'click' }), {
        decision: 'open-external',
        reason: 'approved-editorial-source-click',
      });
      assert.deepEqual(classify(url, { slug, navigationType: 'other' }), {
        decision: 'block',
        reason: 'external-not-user-initiated',
      });
      assert.deepEqual(classify(url, { slug, navigationType: 'click', isTopFrame: false }), {
        decision: 'block',
        reason: 'external-not-user-initiated',
      });
    }
  }

  assert.deepEqual(
    classify('https://www.who.int/news-room/fact-sheets/detail/healthy-diet?unreviewed=1', {
      navigationType: 'click',
    }),
    { decision: 'block', reason: 'host-not-allowed' },
  );
  assert.deepEqual(
    classify(APPROVED_EDITORIAL_SOURCE_URLS['healthy-recipes'][0], {
      slug: 'clinic-guide',
      navigationType: 'click',
    }),
    { decision: 'block', reason: 'host-not-allowed' },
  );
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

test('production owner contact allowlist matches the four exact Task 6B actions', () => {
  const expected = [
    'mailto:ivan@ivanguaderrama.com',
    'tel:+526241224865',
    'https://maps.apple.com/place?address=In%20front%20of%20Plaza%20Amelia%20Wilkes%2C%20Hidalgo%2C%20Calle%20Cabo%20San%20Lucas%2010%2C%20Centro%2C%2023410%20Cabo%20San%20Lucas%2C%20B.C.S.%2C%20Mexico&name=Cabo%20Health',
    'https://wa.me/526241224865',
  ];
  assert.deepEqual(PUBLIC_CONTACT_URLS, expected);
  for (const url of expected) {
    assert.deepEqual(
      classify(url, { navigationType: 'click' }, PUBLIC_CONTACT_URLS),
      { decision: 'open-external', reason: 'approved-contact-click' },
    );
  }
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

test('a canonical public route waits for the initial live withdrawal check', () => {
  assert.equal(shouldWaitForPublicCatalogRoute('sun-care', true), true);
  assert.equal(shouldWaitForPublicCatalogRoute('sun-care', false), false);
  for (const malformed of [undefined, ['sun-care'], 'sun--care', 'Sun-care', 'a'.repeat(65)]) {
    assert.equal(shouldWaitForPublicCatalogRoute(malformed, true), false);
  }
});

test('permanently retired public routes fail immediately instead of waiting for catalog refresh', () => {
  for (const slug of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    assert.equal(shouldWaitForPublicCatalogRoute(slug, true), false, slug);
  }
});

test('a validated runtime miniapp resolves and stays confined to its exact path prefix', () => {
  assert.equal(resolvePublicMiniappRouteSlug('sun-care', [dynamicMiniapp]), 'sun-care');
  assert.deepEqual(classifyMiniappNavigation({
    slug: 'sun-care',
    miniapp: dynamicMiniapp,
    url: 'https://cabohealth.org/apps/sun-care/details/',
    platform: 'ios',
    navigationType: 'other',
    isTopFrame: true,
    isPopup: false,
  }), { decision: 'allow-webview', reason: 'selected-miniapp-path' });
  assert.deepEqual(classifyMiniappNavigation({
    slug: 'sun-care',
    miniapp: dynamicMiniapp,
    url: 'https://cabohealth.org/apps/another-public-app/',
    platform: 'ios',
    navigationType: 'other',
    isTopFrame: true,
    isPopup: false,
  }), { decision: 'block', reason: 'cross-miniapp-path' });
});

test('runtime route resolution rejects every permanently retired supplied miniapp id', () => {
  for (const slug of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    assert.equal(resolvePublicMiniappRouteSlug(slug, [{ ...dynamicMiniapp, slug }]), undefined, slug);
  }
});

test('runtime navigation rejects every permanently retired supplied miniapp boundary', () => {
  for (const slug of ['health-advisor', 'ai-cosmetic-scan', 'service-hub', 'sleep-lab']) {
    const url = `https://cabohealth.org/apps/${slug}/`;
    assert.deepEqual(classifyMiniappNavigation({
      slug,
      miniapp: {
        ...dynamicMiniapp,
        slug,
        canonicalUrl: url,
        universalLink: url,
        allowedPathPrefix: `/apps/${slug}/`,
      },
      url,
      platform: 'ios',
      navigationType: 'other',
      isTopFrame: true,
      isPopup: false,
    }), { decision: 'block', reason: 'unknown-miniapp' }, slug);
  }
});

test('a malformed runtime miniapp object fails closed instead of throwing', () => {
  assert.deepEqual(classifyMiniappNavigation({
    slug: 'sun-care',
    miniapp: {
      slug: 'sun-care',
      canonicalUrl: 'https://cabohealth.org/apps/sun-care/',
      universalLink: 'https://cabohealth.org/apps/sun-care/',
      allowedPathPrefix: '/apps/sun-care/',
    },
    url: 'https://cabohealth.org/apps/sun-care/',
    platform: 'ios',
    navigationType: 'other',
    isTopFrame: true,
    isPopup: false,
  }), { decision: 'block', reason: 'unknown-miniapp' });
});

test('a runtime miniapp cannot add an external URL to the legal allowlist', () => {
  const url = 'https://example.test/injected-legal';
  assert.deepEqual(classifyMiniappNavigation({
    slug: 'sun-care',
    miniapp: {
      ...dynamicMiniapp,
      legalUrls: { ...dynamicMiniapp.legalUrls, injected: url },
    },
    url,
    platform: 'ios',
    navigationType: 'click',
    isTopFrame: true,
    isPopup: false,
  }), { decision: 'block', reason: 'unknown-miniapp' });
});
