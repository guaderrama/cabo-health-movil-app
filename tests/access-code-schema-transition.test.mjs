import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExpectedTransitionState,
  buildSchemaVersionPatch,
  classifyTransitionSnapshot,
  parseGcloudVersionOutput,
  parseJsonSequence,
  parseTransitionArguments,
} from '../scripts/access-code-schema-transition.mjs';

const project = 'cabohealth-owner-prod';
const database = '(default)';
const prefix = `projects/${project}/databases/${database}/documents/_private_access_codes/`;
const updateTime = '2026-08-24T19:00:00.123456Z';

function response(idCharacter, fields) {
  return {
    document: {
      fields,
      name: `${prefix}ac_${idCharacter.repeat(32)}`,
      updateTime,
    },
  };
}

function integerValue(value) {
  return { integerValue: String(value) };
}

test('transition argument parser keeps check read-only and migrate explicitly pinned', () => {
  assert.deepEqual(parseTransitionArguments([
    'check',
    '--project=cabohealth-owner-prod',
    '--database=(default)',
    '--expect=before',
  ]), {
    action: 'check',
    database,
    expect: 'before',
    project,
  });
  const sha = 'a'.repeat(64);
  assert.deepEqual(parseTransitionArguments([
    'migrate',
    '--project=cabohealth-owner-prod',
    '--database=(default)',
    '--apply',
    `--reviewed-bridge-build-tree-sha256=${sha}`,
    `--reviewed-bridge-runtime-sha256=${sha}`,
    `--reviewed-script-sha256=${sha}`,
    `--reviewed-bridge-source-sha256=${sha}`,
    `--reviewed-before-state-sha256=${sha}`,
    '--reviewed-gcloud-version=567.0.0',
    '--reviewed-node-version=22.22.3',
    `--reviewed-operator-account-sha256=${sha}`,
  ]), {
    action: 'migrate',
    database,
    project,
    reviewedBeforeStateSha256: sha,
    reviewedBridgeBuildTreeSha256: sha,
    reviewedBridgeRuntimeSha256: sha,
    reviewedBridgeSourceSha256: sha,
    reviewedGcloudVersion: '567.0.0',
    reviewedNodeVersion: '22.22.3',
    reviewedOperatorAccountSha256: sha,
    reviewedScriptSha256: sha,
  });
  assert.throws(() => parseTransitionArguments([
    'check',
    '--project=wrong-project',
    '--database=(default)',
    '--expect=before',
  ]), /wrong_project/u);
  assert.throws(() => parseTransitionArguments([
    'migrate',
    '--project=cabohealth-owner-prod',
    '--database=(default)',
  ]), /apply_flag_required/u);
});

test('gcloud version pin is parsed only from validated JSON output', () => {
  assert.equal(parseGcloudVersionOutput(JSON.stringify({
    'Google Cloud SDK': '567.0.0',
    bq: '2.1.31',
  })), '567.0.0');
  assert.throws(() => parseGcloudVersionOutput('Google Cloud SDK 567.0.0'), /gcloud_version_response_invalid/u);
  assert.throws(() => parseGcloudVersionOutput(JSON.stringify({
    'Google Cloud SDK': 'latest',
  })), /gcloud_version_response_invalid/u);
});

test('Firestore streaming JSON is parsed without placing transaction data in a URL', () => {
  assert.deepEqual(parseJsonSequence('[{"missing":"a"}]'), [{ missing: 'a' }]);
  assert.deepEqual(parseJsonSequence('{"found":{"name":"a"}}\n{"missing":"b"}\n'), [
    { found: { name: 'a' } },
    { missing: 'b' },
  ]);
  assert.throws(() => parseJsonSequence('{"missing":"a"'), /firestore_response_invalid/u);
});

test('sanitized classifier recognizes only the exact before and after shapes', () => {
  const before = classifyTransitionSnapshot({
    accessCodeResponses: [response('a', { schemaVersion: integerValue(1) })],
    activeCounterPresent: false,
    legacySlotDocumentCount: 0,
  });
  assertExpectedTransitionState(before, 'before');
  assert.equal(before.counts.schema1Slotless, 1);
  assert.equal(before.counts.schema2Slotless, 0);
  assert.match(before.stateSha256, /^[0-9a-f]{64}$/u);
  assert.match(before.sanitizedState.transitionDocumentNameSha256, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(before.sanitizedState).includes(`ac_${'a'.repeat(32)}`), false);
  assert.equal(JSON.stringify(before.sanitizedState).includes(updateTime), false);

  const after = classifyTransitionSnapshot({
    accessCodeResponses: [response('a', { schemaVersion: integerValue(2) })],
    activeCounterPresent: false,
    legacySlotDocumentCount: 0,
  });
  assertExpectedTransitionState(after, 'after');
  assert.equal(after.counts.schema1Slotless, 0);
  assert.equal(after.counts.schema2Slotless, 1);
});

test('classifier counts legacy and every ambiguous schema shape without accepting it', () => {
  const snapshot = classifyTransitionSnapshot({
    accessCodeResponses: [
      response('a', { schemaVersion: integerValue(1), slot: integerValue(1) }),
      response('b', { schemaVersion: integerValue(1), slot: integerValue(5) }),
      response('c', { schemaVersion: integerValue(2), slot: integerValue(1) }),
      response('d', { schemaVersion: { stringValue: '1' } }),
    ],
    activeCounterPresent: true,
    legacySlotDocumentCount: 2,
  });
  assert.deepEqual(snapshot.counts, {
    activeCounterPresent: true,
    invalid: 3,
    legacySlotDocuments: 2,
    schema1Slotless: 0,
    schema1Slotted: 1,
    schema2Slotless: 0,
    totalAccessCodes: 4,
  });
  assert.throws(() => assertExpectedTransitionState(snapshot, 'before'), /unexpected_before_state/u);
});

test('migration patch changes only schemaVersion and binds exact updateTime', () => {
  const name = `${prefix}ac_${'z'.repeat(32)}`;
  const patch = buildSchemaVersionPatch({ database, documentName: name, project, updateTime });
  assert.equal(patch.method, 'PATCH');
  assert.deepEqual(JSON.parse(patch.body), {
    fields: { schemaVersion: { integerValue: '2' } },
  });
  const url = new URL(patch.url);
  assert.deepEqual([...url.searchParams.keys()], [
    'updateMask.fieldPaths',
    'currentDocument.updateTime',
    'mask.fieldPaths',
  ]);
  assert.equal(url.searchParams.get('updateMask.fieldPaths'), 'schemaVersion');
  assert.equal(url.searchParams.get('currentDocument.updateTime'), updateTime);
  assert.equal(url.searchParams.get('mask.fieldPaths'), 'schemaVersion');
  assert.equal(url.pathname.endsWith(`/_private_access_codes/ac_${'z'.repeat(32)}`), true);
});
