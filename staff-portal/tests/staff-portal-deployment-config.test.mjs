import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STAFF_FUNCTIONS_REGION,
  resolveFunctionsOrigin,
  validateStaffFirebaseConfig,
} from '../.test-build/firebase/staffFirebaseConfig.js';

const valid = Object.freeze({
  firebase: Object.freeze({
    apiKey: 'public-firebase-web-api-key',
    authDomain: 'cabohealth-prod.firebaseapp.com',
    projectId: 'cabohealth-prod',
    appId: '1:123456789012:web:abcdef0123456789',
  }),
  appCheckSiteKey: 'public-recaptcha-enterprise-site-key',
  functionsRegion: 'us-central1',
  deployment: Object.freeze({
    appEnv: 'production',
    expectedProjectId: 'cabohealth-prod',
    expectedWebAppId: '1:123456789012:web:abcdef0123456789',
    backendStaffWebAppId: '1:123456789012:web:abcdef0123456789',
  }),
});

test('production config accepts only the externally pinned production identity', () => {
  assert.deepEqual(validateStaffFirebaseConfig(valid), valid);
  assert.equal(STAFF_FUNCTIONS_REGION, 'us-central1');
  assert.equal(
    resolveFunctionsOrigin(valid),
    'https://us-central1-cabohealth-prod.cloudfunctions.net',
  );
});

test('config rejects missing environment pins and every project or backend identity mismatch', () => {
  const invalidConfigs = [
    { ...valid, firebase: { ...valid.firebase, projectId: 'instalacionmariposas', authDomain: 'instalacionmariposas.firebaseapp.com' } },
    { ...valid, firebase: { ...valid.firebase, projectId: 'cabohealth-other', authDomain: 'cabohealth-other.firebaseapp.com' } },
    { ...valid, firebase: { ...valid.firebase, authDomain: 'cabohealth-staging.firebaseapp.com' } },
    { ...valid, firebase: { ...valid.firebase, appId: '1:123456789012:ios:abcdef0123456789' } },
    { ...valid, functionsRegion: 'northamerica-northeast1' },
    { ...valid, deployment: { ...valid.deployment, appEnv: '' } },
    { ...valid, deployment: { ...valid.deployment, appEnv: 'preview' } },
    { ...valid, deployment: { ...valid.deployment, expectedProjectId: 'cabohealth-staging' } },
    { ...valid, deployment: { ...valid.deployment, expectedProjectId: 'cabohealth-other' } },
    { ...valid, deployment: { ...valid.deployment, expectedWebAppId: '1:123456789012:web:1111111111111111' } },
    { ...valid, deployment: { ...valid.deployment, backendStaffWebAppId: '1:123456789012:web:2222222222222222' } },
    { ...valid, deployment: undefined },
  ];

  for (const candidate of invalidConfigs) {
    assert.throws(() => validateStaffFirebaseConfig(candidate), /staff_firebase_(?:config_missing|identity_invalid)/u);
    assert.equal(resolveFunctionsOrigin(candidate), 'https://invalid.invalid');
  }
});

test('staging and production pins cannot be crossed', () => {
  const staging = {
    ...valid,
    firebase: {
      ...valid.firebase,
      authDomain: 'cabohealth-staging.firebaseapp.com',
      projectId: 'cabohealth-staging',
      appId: '1:123456789012:web:1111111111111111',
    },
    deployment: {
      appEnv: 'staging',
      expectedProjectId: 'cabohealth-staging',
      expectedWebAppId: '1:123456789012:web:1111111111111111',
      backendStaffWebAppId: '1:123456789012:web:1111111111111111',
    },
  };
  assert.deepEqual(validateStaffFirebaseConfig(staging), staging);
  assert.throws(() => validateStaffFirebaseConfig({
    ...staging,
    deployment: { ...staging.deployment, appEnv: 'production' },
  }), /staff_firebase_identity_invalid/u);
});
