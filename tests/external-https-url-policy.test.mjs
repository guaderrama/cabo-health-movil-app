import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  isSafeSameOriginExternalNavigation,
  parseSafeExternalHttpsDestination,
} from '../.test-build/features/launch/externalHttpsUrlPolicy.js';

const cases = JSON.parse(await readFile(
  resolve(process.cwd(), 'tests/fixtures/external-https-url-cases.json'),
  'utf8',
));

test('native external HTTPS parsing matches every accepted external shared fixture', () => {
  for (const fixture of cases.accepted.filter(({ kind }) => kind === 'external_https')) {
    const parsed = parseSafeExternalHttpsDestination(fixture.input);
    assert.deepEqual(parsed, {
      canonicalUrl: fixture.canonical,
      origin: new URL(fixture.canonical).origin,
    }, fixture.input);
    assert.equal(Object.isFrozen(parsed), true);
  }
});

test('native external HTTPS parsing rejects every rejected shared fixture', () => {
  for (const input of cases.rejected) {
    assert.equal(parseSafeExternalHttpsDestination(input), null, input);
  }
});

test('native external HTTPS parsing leaves CaboHealth classification to catalog V3', () => {
  const caboHealth = cases.accepted.find(({ kind }) => kind === 'cabohealth');
  assert.ok(caboHealth);
  assert.equal(parseSafeExternalHttpsDestination(caboHealth.input), null);
});

test('same-origin external navigation requires another safe external HTTPS URL', () => {
  assert.equal(
    isSafeSameOriginExternalNavigation(
      'https://www.eightsleep.com/mx/sleep?view=full#details',
      'https://www.eightsleep.com',
    ),
    true,
  );
  assert.equal(
    isSafeSameOriginExternalNavigation(
      'https://accounts.eightsleep.com/',
      'https://www.eightsleep.com',
    ),
    false,
  );
  assert.equal(
    isSafeSameOriginExternalNavigation(
      'https://www.eightsleep.com/%2e%2e/private',
      'https://www.eightsleep.com',
    ),
    false,
  );
  assert.equal(
    isSafeSameOriginExternalNavigation(
      'https://cabohealth.org/apps/healthy-recipes/',
      'https://cabohealth.org',
    ),
    false,
  );
});
