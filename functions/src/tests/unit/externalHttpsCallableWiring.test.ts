import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { HttpsError } from 'firebase-functions/v2/https';

import { handleCreateClientLaunchV2 } from '../../index.js';

test('getPublishedCatalogV3 requires client App Check and exact empty input without authentication', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  const block = callableBlock(source, 'getPublishedCatalogV3');

  assert.match(block, /onCall\(baseCallableOptions/u);
  assert.match(block, /assertClientAppCheck\(request\)/u);
  assert.match(block, /assertEmptyData\(request\.data, 'invalid_catalog_request'\)/u);
  assert.match(block, /createCatalogService\(\)\.publishedCatalogV3\(\)/u);
  assert.doesNotMatch(block, /assert(?:Client|AppReview|ProductionAdmin|ProductionStaff)Auth/u);
  assert.doesNotMatch(block, /request\.auth/u);
});

test('createClientLaunchV2 rejects caller-supplied targetUrl before invoking the launch service', async () => {
  let serviceCalls = 0;
  const launchService = {
    async createV2() {
      serviceCalls += 1;
      return {
        kind: 'external_https' as const,
        expiresAtMs: 1,
        url: 'https://attacker.example/',
      };
    },
  };

  await assert.rejects(
    handleCreateClientLaunchV2({
      installationId: 'a'.repeat(32),
      resourceId: 'external-89abcdef0123456789abcdef01234567',
      targetUrl: 'https://attacker.example/',
    }, `client_${'s'.repeat(32)}`, launchService),
    (error: unknown) => error instanceof HttpsError && error.code === 'invalid-argument',
  );
  assert.equal(serviceCalls, 0);
});

test('createClientLaunchV2 reuses App Check, client Auth, installation secret, and exact input parsing', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  const block = callableBlock(source, 'createClientLaunchV2');

  assert.match(block, /onCall\(\{[\s\S]*?\.\.\.baseCallableOptions/u);
  assert.match(block, /secrets: \[INSTALLATION_PEPPER_RING, LAUNCH_NONCE_PEPPER_RING\]/u);
  assert.match(block, /assertClientAppCheck\(request\)/u);
  assert.match(block, /const subjectUid = assertClientAuth\(request\)/u);
  assert.match(block, /handleCreateClientLaunchV2\(request\.data, subjectUid\)/u);
});

function callableBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name} =`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nexport const ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}
