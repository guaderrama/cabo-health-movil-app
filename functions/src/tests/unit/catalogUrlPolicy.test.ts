import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  catalogIdentityMatches,
  externalCatalogIdFromRequestId,
  isLegacyCompatibleCatalogUrl,
  parseSafeCatalogUrl,
} from '../../domain/catalogUrlPolicy.js';

interface UrlCaseFixture {
  readonly accepted: readonly Readonly<{
    canonical: string;
    id?: string;
    input: string;
    kind: 'cabohealth' | 'external_https';
  }>[];
  readonly rejected: readonly string[];
}

const cases = JSON.parse(
  await readFile(
    resolve(process.cwd(), '../tests/fixtures/external-https-url-cases.json'),
    'utf8',
  ),
) as UrlCaseFixture;

test('accepts and canonicalizes safe public HTTPS destinations', () => {
  for (const fixture of cases.accepted) {
    const parsed = parseSafeCatalogUrl(fixture.input);
    assert.equal(parsed?.url, fixture.canonical, fixture.input);
    assert.equal(parsed?.kind, fixture.kind, fixture.input);
    if (fixture.kind === 'cabohealth' && parsed?.kind === 'cabohealth') {
      assert.equal(parsed.id, fixture.id, fixture.input);
    }
  }
});

test('rejects unsafe schemes, userinfo, non-default ports, local or IP hosts, reserved CaboHealth paths, controls, malformed escapes, encoded traversal and encoded separators', () => {
  for (const input of cases.rejected) assert.equal(parseSafeCatalogUrl(input), null, input);
});

test('external IDs are request-id based, stable, and independent of URL', () => {
  assert.equal(
    externalCatalogIdFromRequestId('00000000-0000-4000-8000-000000000001'),
    'external-56fa9fb720ac24267528ab1819751b5b',
  );
  assert.equal(
    externalCatalogIdFromRequestId('00000000-0000-4000-8000-000000000002'),
    'external-1c550e51dc2968514dc81f218a8fb5a8',
  );
  for (const invalid of ['00000000-0000-4000-8000-00000000000A', 'not-a-uuid']) {
    assert.throws(() => externalCatalogIdFromRequestId(invalid), /invalid_admin_input/u);
  }
});

test('matches only the identity class permitted by a safe destination', () => {
  assert.equal(
    catalogIdentityMatches('healthy-recipes', 'https://cabohealth.org/apps/healthy-recipes/'),
    true,
  );
  assert.equal(
    catalogIdentityMatches('shared', 'https://cabohealth.org/apps/shared/'),
    false,
  );
  assert.equal(
    catalogIdentityMatches('external-56fa9fb720ac24267528ab1819751b5b', 'https://example.org/a'),
    true,
  );
  assert.equal(catalogIdentityMatches('healthy-recipes', 'https://example.org/a'), false);
});

test('marks only safe CaboHealth catalog URLs as legacy compatible', () => {
  assert.equal(isLegacyCompatibleCatalogUrl('https://cabohealth.org/apps/healthy-recipes/'), true);
  assert.equal(isLegacyCompatibleCatalogUrl('https://example.org/a'), false);
  assert.equal(isLegacyCompatibleCatalogUrl('https://cabohealth.org/apps/shared/'), false);
});
