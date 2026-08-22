import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertFirebaseBootstrapAdminEnvironment } from '../../infrastructure/firebaseBootstrapAdminSdk.js';

test('Admin SDK bootstrap rejects emulators and any ambient project mismatch', () => {
  const projectId = 'cabohealth-owner-prod';
  assert.doesNotThrow(() => assertFirebaseBootstrapAdminEnvironment(projectId, {}));
  assert.doesNotThrow(() => assertFirebaseBootstrapAdminEnvironment(projectId, {
    GCLOUD_PROJECT: projectId,
    GOOGLE_CLOUD_PROJECT: projectId,
    FIREBASE_CONFIG: JSON.stringify({ projectId }),
  }));

  for (const environment of [
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { GCLOUD_PROJECT: 'cabohealth-other-prod' },
    { GOOGLE_CLOUD_PROJECT: 'cabohealth-other-prod' },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: 'cabohealth-other-prod' }) },
    { FIREBASE_CONFIG: '{not-json' },
  ]) {
    assert.throws(
      () => assertFirebaseBootstrapAdminEnvironment(projectId, environment),
      /firebase_bootstrap_admin_environment_invalid/u,
    );
  }
});
