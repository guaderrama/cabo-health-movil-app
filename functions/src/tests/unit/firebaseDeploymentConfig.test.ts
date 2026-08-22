import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Firebase config has no legacy/default project and requires explicit safe aliases', async () => {
  const parsed: unknown = JSON.parse(await readFile('../.firebaserc', 'utf8'));
  assert.ok(isRecord(parsed) && isRecord(parsed.projects));
  assert.deepEqual(Object.keys(parsed.projects).sort(), ['cabohealth-prod', 'cabohealth-staging']);
  assert.equal(Object.hasOwn(parsed.projects, 'default'), false);
  assert.match(String(parsed.projects['cabohealth-staging']), /^UNCONFIGURED_/u);
  assert.match(String(parsed.projects['cabohealth-prod']), /^UNCONFIGURED_/u);
  assert.doesNotMatch(JSON.stringify(parsed), /instalacionmariposas/u);
});

test('Firestore index config contains no legacy catalog index', async () => {
  const parsed: unknown = JSON.parse(await readFile('../firestore.indexes.json', 'utf8'));
  assert.ok(isRecord(parsed));
  assert.deepEqual(parsed.indexes, []);
  assert.ok(Array.isArray(parsed.fieldOverrides));
  assert.deepEqual(
    parsed.fieldOverrides.map((override) => {
      assert.ok(isRecord(override));
      assert.deepEqual(override.indexes, []);
      assert.equal(override.fieldPath, 'expiresAtMs');
      assert.equal(override.ttl, true);
      return override.collectionGroup;
    }).sort(),
    [
      '_private_audit_events',
      '_private_broker_requests',
      '_private_launch_nonces',
      '_private_rate_limits',
      '_private_redemption_requests',
      '_private_web_sessions',
    ],
  );
  assert.doesNotMatch(JSON.stringify(parsed), /cabohealth_apps/u);
});

test('App Review named-database rules and TTL policy are isolated and default-deny', async () => {
  const rules = await readFile('../firestore.review.rules', 'utf8');
  assert.match(rules, /allow read, write: if false/u);
  const parsed: unknown = JSON.parse(await readFile('../firestore.review.indexes.json', 'utf8'));
  assert.ok(isRecord(parsed));
  assert.deepEqual(parsed.indexes, []);
  assert.ok(Array.isArray(parsed.fieldOverrides));
  assert.deepEqual(parsed.fieldOverrides.map((override) => {
    assert.ok(isRecord(override));
    assert.equal(override.fieldPath, 'expiresAtMs');
    assert.equal(override.ttl, true);
    assert.deepEqual(override.indexes, []);
    return override.collectionGroup;
  }).sort(), [
    'review_sandbox_broker_requests',
    'review_sandbox_launch_nonces',
    'review_sandbox_rate_limits',
    'review_sandbox_redemption_requests',
    'review_sandbox_web_sessions',
  ]);
  assert.doesNotMatch(JSON.stringify(parsed), /_private_|client_|cabohealth_apps/u);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
