import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { authorizeAppCheckSurface } from '../../security/appCheckAuthorization.js';

const iosAppId = '1:123456789012:ios:abcdef0123456789abcd';
const webAppId = '1:123456789012:web:0123456789abcdefabcd';

test('App Check is bound to the exact configured Firebase app ID and surface', () => {
  assert.doesNotThrow(() => authorizeAppCheckSurface({
    app: { alreadyConsumed: false, appId: iosAppId },
    expectedAppId: iosAppId,
    expectedPlatform: 'ios',
  }));
  assert.doesNotThrow(() => authorizeAppCheckSurface({
    app: { appId: webAppId },
    expectedAppId: webAppId,
    expectedPlatform: 'web',
  }));

  for (const candidate of [
    { app: undefined, expectedAppId: iosAppId, expectedPlatform: 'ios' as const },
    { app: { alreadyConsumed: true, appId: iosAppId }, expectedAppId: iosAppId, expectedPlatform: 'ios' as const },
    { app: { appId: webAppId }, expectedAppId: iosAppId, expectedPlatform: 'ios' as const },
    { app: { appId: iosAppId }, expectedAppId: webAppId, expectedPlatform: 'web' as const },
    { app: { appId: iosAppId }, expectedAppId: '', expectedPlatform: 'ios' as const },
    { app: { appId: iosAppId }, expectedAppId: webAppId, expectedPlatform: 'ios' as const },
  ]) {
    assert.throws(() => authorizeAppCheckSurface(candidate), /app_attestation_failed/u);
  }
});

test('every callable is wired to the correct iOS or staff-web App Check surface', async () => {
  const source = await readFile('src/index.ts', 'utf8');
  const staffCallables = [
    'adminCreateClientAccessCode',
    'adminGetStaffSession',
    'adminListClientAccessCodes',
    'adminRevokeClientAccessCode',
  ];
  const clientCallables = [
    'redeemClientAccessCode',
    'refreshClientAccess',
    'removeClientAccess',
    'deleteClientAccount',
    'createClientLaunch',
  ];
  for (const callable of staffCallables) {
    assert.match(source, new RegExp(
      `export const ${callable} =[\\s\\S]{0,800}?assertStaffAppCheck\\(request\\)`,
      'u',
    ));
  }
  for (const callable of clientCallables) {
    assert.match(source, new RegExp(
      `export const ${callable} =[\\s\\S]{0,800}?assertClientAppCheck\\(request\\)`,
      'u',
    ));
  }
  assert.equal(source.match(/assertStaffAppCheck\(request\)/gu)?.length, 4);
  assert.equal(source.match(/assertClientAppCheck\(request\)/gu)?.length, 5);
});
