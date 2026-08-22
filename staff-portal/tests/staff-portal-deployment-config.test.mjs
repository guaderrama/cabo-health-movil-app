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
});

test('production config accepts only a dedicated CaboHealth web app identity', () => {
  assert.deepEqual(validateStaffFirebaseConfig(valid), valid);
  assert.equal(STAFF_FUNCTIONS_REGION, 'us-central1');
  assert.equal(
    resolveFunctionsOrigin(valid.firebase.projectId, valid.functionsRegion),
    'https://us-central1-cabohealth-prod.cloudfunctions.net',
  );
});

test('production config rejects legacy, cross-project, non-web, and alternate-region identities', () => {
  const invalidConfigs = [
    { ...valid, firebase: { ...valid.firebase, projectId: 'instalacionmariposas', authDomain: 'instalacionmariposas.firebaseapp.com' } },
    { ...valid, firebase: { ...valid.firebase, authDomain: 'cabohealth-staging.firebaseapp.com' } },
    { ...valid, firebase: { ...valid.firebase, appId: '1:123456789012:ios:abcdef0123456789' } },
    { ...valid, functionsRegion: 'northamerica-northeast1' },
  ];

  for (const candidate of invalidConfigs) {
    assert.throws(() => validateStaffFirebaseConfig(candidate), /staff_firebase_identity_invalid/u);
  }
  assert.equal(resolveFunctionsOrigin('instalacionmariposas', 'us-central1'), 'https://invalid.invalid');
  assert.equal(resolveFunctionsOrigin('cabohealth-prod', 'europe-west1'), 'https://invalid.invalid');
});
