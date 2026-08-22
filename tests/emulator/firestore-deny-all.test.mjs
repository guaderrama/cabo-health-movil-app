import assert from 'node:assert/strict';
import { test } from 'node:test';

const PROJECT_ID = 'demo-cabohealth';
const DATABASE_IDS = ['(default)', 'cabohealth-review-emulator'];
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

assert.match(
  emulatorHost ?? '',
  /^(?:127\.0\.0\.1|localhost):[0-9]{2,5}$/u,
  'run through npm run test:firestore-rules:emulator',
);

for (const databaseId of DATABASE_IDS) {
  for (const operation of ['read', 'write']) {
    test(`${databaseId} rejects an unauthenticated client ${operation}`, async () => {
      const url = new URL(
        `/v1/projects/${PROJECT_ID}/databases/${databaseId}/documents/rules_probe/attempt`,
        `http://${emulatorHost}`,
      );
      const response = await fetch(url, operation === 'write'
        ? {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields: { probe: { booleanValue: true } } }),
          }
        : undefined);

      assert.equal(response.status, 403, await response.text());
    });
  }
}
