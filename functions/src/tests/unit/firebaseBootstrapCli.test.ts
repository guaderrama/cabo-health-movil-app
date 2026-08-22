import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  executeFirebaseBootstrapCommand,
  parseFirebaseBootstrapArguments,
} from '../../tools/bootstrapFirebase.js';

const identityArguments = [
  '--environment', 'production',
  '--project-id', 'cabohealth-owner-prod',
  '--review-database-id', 'cabohealth-review-production',
] as const;

test('bootstrap CLI defaults to a local plan and takes the owner UID only from a private file', () => {
  assert.deepEqual(parseFirebaseBootstrapArguments([
    ...identityArguments,
    '--owner-uid-file', '/private/owner-uid.txt',
    '--plan-out', '/private/bootstrap-plan.json',
  ]), {
    apply: false,
    environment: 'production',
    ownerUidFile: '/private/owner-uid.txt',
    planOut: '/private/bootstrap-plan.json',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
  });
});

test('bootstrap CLI apply mode requires an existing plan and its reviewed SHA-256', () => {
  assert.deepEqual(parseFirebaseBootstrapArguments([
    ...identityArguments,
    '--plan-file', '/private/bootstrap-plan.json',
    '--apply',
    '--reviewed-plan-sha256', 'a'.repeat(64),
  ]), {
    apply: true,
    environment: 'production',
    planFile: '/private/bootstrap-plan.json',
    projectId: 'cabohealth-owner-prod',
    reviewDatabaseId: 'cabohealth-review-production',
    reviewedPlanSha256: 'a'.repeat(64),
  });
});

test('bootstrap CLI rejects duplicate, arbitrary, mixed-mode, or incomplete input', () => {
  for (const arguments_ of [
    [...identityArguments, '--url', 'https://example.org/'],
    [...identityArguments, '--project-id', 'cabohealth-other-prod'],
    [...identityArguments, '--plan-file', '/private/plan.json', '--apply'],
    [
      ...identityArguments,
      '--owner-uid-file', '/private/owner.txt',
      '--plan-out', '/private/plan.json',
      '--apply',
      '--reviewed-plan-sha256', 'a'.repeat(64),
    ],
  ]) {
    assert.throws(
      () => parseFirebaseBootstrapArguments(arguments_),
      /firebase_bootstrap_arguments_invalid/u,
    );
  }
});

test('plan execution reads a private owner file, writes a private exact plan, and emits only sanitized evidence', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'cabohealth-bootstrap-'));
  try {
    const privateDirectory = join(repositoryRoot, 'release', 'private');
    await mkdir(privateDirectory, { mode: 0o700, recursive: true });
    const ownerUidFile = join(privateDirectory, 'owner-uid.txt');
    const planOut = join(privateDirectory, 'bootstrap-plan.json');
    await writeFile(ownerUidFile, 'owner_uid_0123456789\n', { mode: 0o600 });

    let boundaryLoads = 0;
    const evidence = await executeFirebaseBootstrapCommand({
      boundary: async () => {
        boundaryLoads += 1;
        throw new Error('must_not_load');
      },
      command: {
        apply: false,
        environment: 'production',
        ownerUidFile,
        planOut,
        projectId: 'cabohealth-owner-prod',
        reviewDatabaseId: 'cabohealth-review-production',
      },
      repositoryRoot,
    });

    const planText = await readFile(planOut, 'utf8');
    assert.match(planText, /owner_uid_0123456789/u);
    assert.equal(JSON.stringify(evidence).includes('owner_uid_0123456789'), false);
    assert.equal(evidence.status, 'dry-run');
    assert.equal(boundaryLoads, 0);
    assert.equal((await stat(planOut)).mode & 0o077, 0);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
