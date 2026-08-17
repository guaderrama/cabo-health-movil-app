import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const helperPath = join(projectRoot, 'scripts/secure_web_release.py');
const fixtureTmp = realpathSync(tmpdir());
const paths = Object.freeze([
  '.well-known/apple-app-site-association',
  'app/privacy/index.html',
  'app/report-content/index.html',
  'app/support/index.html',
  'app/terms/index.html',
  'apps/.htaccess',
  'apps/clinic-guide/app.js',
  'apps/clinic-guide/index.html',
  'apps/healthy-recipes/app.js',
  'apps/healthy-recipes/index.html',
  'apps/shared/logo.png',
  'apps/shared/motion.js',
  'apps/shared/shell.js',
  'apps/shared/styles.css',
]);
const targets = Object.freeze([
  'public_html/apps/.htaccess',
  'public_html/apps/shared',
  'public_html/app/privacy',
  'public_html/app/terms',
  'public_html/app/support',
  'public_html/app/report-content',
  'public_html/apps/healthy-recipes',
  'public_html/apps/clinic-guide',
  'public_html/.well-known/apple-app-site-association',
]);
const operationLockBytes = Buffer.from('CABOHEALTH_OPERATION_LOCK_V1\n');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function mediaType(path) {
  if (path.endsWith('apple-app-site-association')) return 'application/json';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'text/plain; charset=utf-8';
}

function kind(path) {
  if (path === 'apps/.htaccess') return 'apache-security';
  if (path.startsWith('apps/')) return 'task6b-miniapp';
  if (path.startsWith('app/')) return 'task7-legal';
  return 'aasa';
}

function fixtureTransport() {
  const files = paths.map((path) => {
    const bytes = Buffer.from(`round3:${path}\n`);
    return {
      path,
      size: bytes.length,
      sha256: sha256(bytes),
      mediaType: mediaType(path),
      deployMode: '0644',
      kind: kind(path),
      bytesBase64: bytes.toString('base64'),
    };
  });
  const policy = {
    schemaVersion: 1,
    artifactKind: 'cabohealth-public-web-v1',
    appId: 'DQ8PH2DZ3R.com.cabohealth.app',
    entrySlugs: ['healthy-recipes', 'clinic-guide'],
    legalSlugs: ['privacy', 'terms', 'support', 'report-content'],
    promoteTargets: [...targets],
    files: files.map(({ bytesBase64: _bytesBase64, ...entry }) => entry),
  };
  const inventorySha256 = sha256(Buffer.from(canonicalJson(policy)));
  return {
    ...policy,
    artifactKind: 'cabohealth-web-transport-v1',
    releaseId: `web-v1-${inventorySha256}`,
    inventorySha256,
    files,
  };
}

function runHelper(root, command, transport, environment = {}, extraArguments = []) {
  return spawnSync('python3', [helperPath, command, root, transport.releaseId, ...extraArguments], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: canonicalJson(transport),
    env: { ...process.env, ...environment },
    timeout: 5000,
  });
}

function writePath(root, path, bytes, mode = 0o644) {
  const components = path.split('/');
  let directory = root;
  for (const component of components.slice(0, -1)) {
    directory = join(directory, component);
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o755 });
  }
  writeFileSync(join(directory, components.at(-1)), bytes, { flag: 'wx', mode });
}

function setup(original = 'absent') {
  const transport = fixtureTransport();
  const root = mkdtempSync(join(fixtureTmp, `cabohealth-round3-${original}-fixture-`));
  const staged = runHelper(root, 'materialize-stage', transport);
  assert.equal(staged.status, 0, staged.stderr || staged.stdout);
  mkdirSync(join(root, 'public_html'), { mode: 0o755 });
  if (original === 'present') writePath(root, 'public_html/apps/.htaccess', 'reviewed old bytes\n');
  return { root, transport };
}

function newBytes(transport, path = 'apps/.htaccess') {
  return Buffer.from(transport.files.find((entry) => entry.path === path).bytesBase64, 'base64');
}

function quarantinePaths(root, transport, slot = '00-apps-htaccess') {
  const rollback = join(root, 'rollback', transport.releaseId);
  return readdirSync(rollback)
    .filter((name) => name.startsWith(`${slot}.quarantine-`) && /^[a-f0-9]{32}$/u.test(name.slice(-32)))
    .map((name) => join(rollback, name));
}

function assertInodeQuarantined(root, transport, inode, slot = '00-apps-htaccess') {
  assert.ok(
    quarantinePaths(root, transport, slot).some((path) => statSync(path).ino === inode),
    `inode ${inode} was not preserved in a unique private quarantine candidate`,
  );
}

test('rollback-next reverses exactly one promoted unit and leaves the earlier prefix live', () => {
  const { root, transport } = setup('absent');
  for (let index = 0; index < 3; index += 1) {
    assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  }
  const result = runHelper(root, 'rollback-next', transport, {}, ['2']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    index: 2,
    target: 'public_html/app/privacy',
    status: 'unit-rolled-back',
    complete: false,
  });
  assert.equal(existsSync(join(root, 'public_html/app/privacy')), false);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), true);
  assert.equal(existsSync(join(root, 'public_html/apps/shared')), true);
  assert.equal(existsSync(join(root, 'stage', transport.releaseId, 'public_html/app/terms')), true);
});

test('rollback-next expected index makes a lost response idempotent before the next probe-authorized unit', () => {
  const { root, transport } = setup('absent');
  for (let index = 0; index < 3; index += 1) assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const first = runHelper(root, 'rollback-next', transport, {}, ['2']);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const retry = runHelper(root, 'rollback-next', transport, {}, ['2']);
  assert.equal(retry.status, 0, retry.stderr || retry.stdout);
  assert.equal(JSON.parse(retry.stdout).index, 2);
  assert.equal(existsSync(join(root, 'public_html/apps/shared')), true);
  const next = runHelper(root, 'rollback-next', transport, {}, ['1']);
  assert.equal(next.status, 0, next.stderr || next.stdout);
  assert.equal(JSON.parse(next.stdout).index, 1);
});

test('equal old and new inventories remain distinct by inode through promotion and rollback', () => {
  const { root, transport } = setup('absent');
  writePath(root, 'public_html/apps/.htaccess', newBytes(transport));
  const oldLiveInode = statSync(join(root, 'public_html/apps/.htaccess')).ino;
  const stagedInode = statSync(join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess')).ino;
  const promoted = runHelper(root, 'promote-next', transport);
  assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
  assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).ino, stagedInode);
  assert.equal(statSync(join(root, 'rollback', transport.releaseId, '00-apps-htaccess')).ino, oldLiveInode);
  const rolled = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(rolled.status, 0, rolled.stderr || rolled.stdout);
  assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).ino, oldLiveInode);
  assert.equal(statSync(join(root, 'rollback', transport.releaseId, '00-apps-htaccess')).ino, stagedInode);
});

test('prepared record authority rejects invalid original/hash semantic combinations', async (context) => {
  for (const [name, mutate] of [
    ['unknown-original', (record) => { record.original = 'other'; record.oldInventorySha256 = null; }],
    ['present-null-hash', (record) => { record.original = 'present'; record.oldInventorySha256 = null; }],
    ['absent-hash', (record) => { record.original = 'absent'; record.oldInventorySha256 = 'a'.repeat(64); }],
  ]) {
    await context.test(name, () => {
      const { root, transport } = setup('absent');
      assert.equal(runHelper(root, 'promote-next', transport).status, 0);
      const recordPath = join(root, 'rollback', transport.releaseId, 'transitions/01-prepared-000.json');
      const record = JSON.parse(readFileSync(recordPath, 'utf8'));
      mutate(record);
      writeFileSync(recordPath, canonicalJson(record));
      const result = runHelper(root, 'promote-next', transport);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, /ROLLBACK_TRANSITION_SEMANTICS_INVALID/u);
      assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
    });
  }
});

test('present authority rejects equal source/destination identity and malformed identity scalars', async (context) => {
  for (const [name, mutate, error] of [
    ['same-inode', (record) => { record.sourceIdentity = { ...record.destinationIdentity }; }, /ROLLBACK_TRANSITION_SEMANTICS_INVALID/u],
    ['boolean-device', (record) => { record.sourceIdentity.device = true; }, /ROLLBACK_TRANSITION_IDENTITY_INVALID/u],
    ['negative-inode', (record) => { record.destinationIdentity.inode = -1; }, /ROLLBACK_TRANSITION_IDENTITY_INVALID/u],
  ]) {
    await context.test(name, () => {
      const { root, transport } = setup('present');
      assert.equal(runHelper(root, 'promote-next', transport).status, 0);
      for (const frame of ['00-prepared-000.json', '00-promoted-000.json']) {
        const recordPath = join(root, 'rollback', transport.releaseId, 'transitions', frame);
        const record = JSON.parse(readFileSync(recordPath, 'utf8'));
        mutate(record);
        writeFileSync(recordPath, canonicalJson(record));
      }
      const result = runHelper(root, 'promote-next', transport);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      assert.match(result.stderr, error);
      assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
    });
  }
});

test('all interrupted candidate byte prefixes are ignored and a new atomic frame is published', () => {
  const { root, transport } = setup('absent');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const candidates = join(root, 'rollback', transport.releaseId, 'transitions/candidates');
  if (!existsSync(candidates)) mkdirSync(candidates, { mode: 0o700 });
  const candidate = Buffer.from('{"arbitrary":"candidate residue that is never authority"}\n');
  for (let length = 0; length <= candidate.length; length += 1) {
    writeFileSync(join(candidates, `01-promoted-${String(length).padStart(3, '0')}.candidate`), candidate.subarray(0, length), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  const result = runHelper(root, 'promote-next', transport);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, 'public_html/apps/shared')), true);
});

test('initial prepared-frame publication resumes after every durable boundary', async (context) => {
  for (const fault of [
    'prepare-frame-crash-after-candidate-create',
    'prepare-frame-crash-after-candidate-write',
    'prepare-frame-crash-after-candidate-fsync',
    'prepare-frame-crash-after-publish',
    'prepare-frame-crash-after-directory-fsync',
  ]) {
    await context.test(fault, () => {
      const { root, transport } = setup('absent');
      const crashed = runHelper(root, 'promote-next', transport, { CABOHEALTH_TEST_FAULT: fault });
      assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
      const resumed = runHelper(root, 'promote-next', transport);
      assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
      assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), true);
    });
  }
});

test('a create-boundary crash under a strict umask leaves ignorable non-authority residue', () => {
  const { root, transport } = setup('absent');
  for (const container of ['apps', 'app', '.well-known']) {
    if (!existsSync(join(root, 'public_html', container))) {
      mkdirSync(join(root, 'public_html', container), { mode: 0o755 });
    }
  }
  const transitions = join(root, 'rollback', transport.releaseId, 'transitions');
  mkdirSync(transitions, { recursive: true, mode: 0o700 });
  const priorUmask = process.umask(0o777);
  let crashed;
  try {
    crashed = runHelper(root, 'promote-next', transport, {
      CABOHEALTH_TEST_FAULT: 'prepare-frame-crash-after-candidate-create',
    });
  } finally {
    process.umask(priorUmask);
  }
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const residue = readdirSync(transitions)
    .find((name) => /^00-prepared-000-[a-f0-9]{16}\.candidate$/u.test(name));
  assert.ok(residue);
  assert.equal(statSync(join(transitions, residue)).mode & 0o777, 0o000);
  const resumed = runHelper(root, 'promote-next', transport);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), true);
});

test('promoted-frame publication resumes or rolls back after every durable boundary', async (context) => {
  for (const fault of [
    'promote-frame-crash-after-candidate-create',
    'promote-frame-crash-after-candidate-write',
    'promote-frame-crash-after-candidate-fsync',
    'promote-frame-crash-after-publish',
    'promote-frame-crash-after-directory-fsync',
  ]) {
    await context.test(fault, () => {
      const { root, transport } = setup('absent');
      const crashed = runHelper(root, 'promote-next', transport, { CABOHEALTH_TEST_FAULT: fault });
      assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
      const rolled = runHelper(root, 'rollback-next', transport, {}, ['0']);
      assert.equal(rolled.status, 0, rolled.stderr || rolled.stdout);
      assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
    });
  }
});

test('the real prepared-frame publisher tolerates a hard crash after every candidate byte boundary', () => {
  const { root, transport } = setup('absent');
  const fullWrite = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'prepare-frame-crash-after-candidate-write',
  });
  assert.equal(fullWrite.status, 86, fullWrite.stderr || fullWrite.stdout);
  const transitions = join(root, 'rollback', transport.releaseId, 'transitions');
  const completeCandidate = readdirSync(transitions)
    .find((name) => /^00-prepared-000-[a-f0-9]{16}\.candidate$/u.test(name));
  assert.ok(completeCandidate);
  const frameLength = readFileSync(join(transitions, completeCandidate)).length;
  assert.ok(frameLength > 0);
  for (let offset = 0; offset <= frameLength; offset += 1) {
    const crashed = runHelper(root, 'promote-next', transport, {
      CABOHEALTH_TEST_FAULT: `prepare-frame-crash-after-byte-${offset}`,
    });
    assert.equal(crashed.status, 86, `offset=${offset}\n${crashed.stderr || crashed.stdout}`);
  }
  const resumed = runHelper(root, 'promote-next', transport);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), true);
});

test('prepared operand identity reverses source substitution followed by a hard crash', async (context) => {
  for (const original of ['present', 'absent']) {
    await context.test(original, () => {
      const { root, transport } = setup(original);
      const reviewedOld = original === 'present'
        ? readFileSync(join(root, 'public_html/apps/.htaccess'))
        : null;
      const reviewedOldInode = reviewedOld
        ? statSync(join(root, 'public_html/apps/.htaccess')).ino
        : null;
      writePath(
        root,
        `stage/${transport.releaseId}/public_html/apps/fault-substitute`,
        'unreviewed substituted operand\n',
      );
      const crashed = runHelper(root, 'promote-next', transport, {
        CABOHEALTH_TEST_FAULT: original === 'present'
          ? 'promote-exchange-substitute-source-crash'
          : 'promote-noreplace-substitute-source-crash',
      });
      assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
      const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
      assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
      assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_(?:RECOVERED|RECOVERY_FAILED)/u);
      if (reviewedOld) {
        assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedOld);
        assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).ino, reviewedOldInode);
      } else assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
    });
  }
});

test('rollback operand identity reverses slot substitution followed by a hard crash', () => {
  const { root, transport } = setup('present');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const reviewedNew = newBytes(transport);
  writePath(root, `rollback/${transport.releaseId}/fault-substitute`, 'unreviewed rollback operand\n', 0o644);
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-exchange-substitute-source-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedNew);
});

test('absent rollback never restores a substituted live operand after a hard crash', () => {
  const { root, transport } = setup('absent');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const reviewedNew = newBytes(transport);
  writePath(root, `rollback/${transport.releaseId}/fault-substitute`, 'unreviewed live operand\n', 0o644);
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-noreplace-substitute-source-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
  assert.deepEqual(
    readFileSync(join(root, 'rollback', transport.releaseId, 'fault-substitute')),
    reviewedNew,
  );
});

test('a retained operation lock prevents two legitimate commands from acting on one prepared intent', async () => {
  const { root, transport } = setup('absent');
  const first = spawn('python3', [helperPath, 'promote-next', root, transport.releaseId], {
    cwd: projectRoot,
    env: { ...process.env, CABOHEALTH_TEST_FAULT: 'operation-lock-hold' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  first.stdin.end(canonicalJson(transport));
  const firstOutput = [];
  const firstError = [];
  first.stdout.on('data', (chunk) => firstOutput.push(chunk));
  first.stderr.on('data', (chunk) => firstError.push(chunk));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  const second = runHelper(root, 'promote-next', transport);
  assert.equal(second.status, 1, second.stderr || second.stdout);
  assert.match(second.stderr, /PROMOTION_OPERATION_BUSY/u);
  const firstStatus = await new Promise((resolvePromise) => first.on('close', resolvePromise));
  assert.equal(firstStatus, 0, Buffer.concat(firstError).toString() || Buffer.concat(firstOutput).toString());
  assert.equal(JSON.parse(Buffer.concat(firstOutput).toString()).index, 0);
  assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
});

test('recovery reverses invalid promotion operands from durable identity before strict inventory', async (context) => {
  for (const [original, fault] of [
    ['present', 'promote-exchange-same-inode-bytes-crash'],
    ['present', 'promote-exchange-symlink-crash'],
    ['present', 'promote-exchange-fifo-crash'],
    ['present', 'promote-exchange-special-crash'],
    ['present', 'promote-exchange-wrong-mode-crash'],
    ['absent', 'promote-noreplace-same-inode-bytes-crash'],
    ['absent', 'promote-noreplace-symlink-crash'],
  ]) {
    await context.test(`${original}-${fault}`, () => {
      const { root, transport } = setup(original);
      const reviewedOld = original === 'present'
        ? readFileSync(join(root, 'public_html/apps/.htaccess'))
        : null;
      const reviewedOldInode = reviewedOld
        ? statSync(join(root, 'public_html/apps/.htaccess')).ino
        : null;
      const crashed = runHelper(root, 'promote-next', transport, { CABOHEALTH_TEST_FAULT: fault });
      assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
      const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
      assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
      assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_(?:RECOVERED|RECOVERY_FAILED)/u);
      if (reviewedOld) {
        assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedOld);
        assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).mode & 0o777, 0o644);
        assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).ino, reviewedOldInode);
      } else {
        assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
      }
    });
  }
});

test('present promotion reconciles a hard crash immediately after publishing the rollback slot', () => {
  const { root, transport } = setup('present');
  const reviewedOld = readFileSync(join(root, 'public_html/apps/.htaccess'));
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-slot-crash-after-namespace',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedOld);
});

test('present promotion reverses a same-inode live mutation after rollback-slot publication', () => {
  const { root, transport } = setup('present');
  const reviewedOld = readFileSync(join(root, 'public_html/apps/.htaccess'));
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-slot-same-inode-live-mutation-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedOld);
});

test('promotion-complete recovery reconciles a post-namespace directory-fsync error safely', () => {
  const { root, transport } = setup('present');
  const reviewedOld = readFileSync(join(root, 'public_html/apps/.htaccess'));
  const reviewedOldInode = statSync(join(root, 'public_html/apps/.htaccess')).ino;
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-slot-same-inode-live-mutation-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-complete-recovery-fsync-oserror',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /INJECTED_PROMOTION_COMPLETE_RECOVERY_FSYNC_OSERROR.*RESTORED_STATE_SAFE/u);
  assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedOld);
  assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).ino, reviewedOldInode);
});

test('live-side exchange substitutions fail closed on reviewed bytes after a hard crash', async (context) => {
  await context.test('promotion live operand', () => {
    const { root, transport } = setup('present');
    const reviewedNew = newBytes(transport);
    const crashed = runHelper(root, 'promote-next', transport, {
      CABOHEALTH_TEST_FAULT: 'promote-exchange-live-symlink-crash',
    });
    assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
    const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
    assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
    assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERY_FAILED/u);
    assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedNew);
    assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).mode & 0o777, 0o644);
  });

  await context.test('rollback live operand', () => {
    const { root, transport } = setup('present');
    const reviewedOld = readFileSync(join(root, 'public_html/apps/.htaccess'));
    const reviewedOldInode = statSync(join(root, 'public_html/apps/.htaccess')).ino;
    assert.equal(runHelper(root, 'promote-next', transport).status, 0);
    const crashed = runHelper(root, 'rollback-next', transport, {
      CABOHEALTH_TEST_FAULT: 'rollback-exchange-live-symlink-crash',
    }, ['0']);
    assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
    const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
    assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
    assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERY_FAILED/u);
    assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedOld);
    assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).ino, reviewedOldInode);
  });
});

test('directory identity recovery reverses wrong-mode and wrong-tree operands after exchange and no-replace', async (context) => {
  for (const [original, fault] of [
    ['present', 'promote-exchange-wrong-tree-crash'],
    ['present', 'promote-exchange-nonascii-wrong-tree-crash'],
    ['present', 'promote-exchange-directory-wrong-mode-crash'],
    ['absent', 'promote-noreplace-wrong-tree-crash'],
  ]) {
    await context.test(`${original}-${fault}`, () => {
      const { root, transport } = setup('absent');
      if (original === 'present') {
        for (const name of ['logo.png', 'motion.js', 'shell.js', 'styles.css']) {
          writePath(root, `public_html/apps/shared/${name}`, `reviewed old ${name}\n`);
        }
      }
      assert.equal(runHelper(root, 'promote-next', transport).status, 0);
      const reviewedOld = original === 'present'
        ? new Map(['logo.png', 'motion.js', 'shell.js', 'styles.css'].map((name) => [
          name,
          readFileSync(join(root, `public_html/apps/shared/${name}`)),
        ]))
        : null;
      const reviewedOldInode = original === 'present'
        ? statSync(join(root, 'public_html/apps/shared')).ino
        : null;
      const crashed = runHelper(root, 'promote-next', transport, { CABOHEALTH_TEST_FAULT: fault });
      assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
      const recovered = runHelper(root, 'rollback-next', transport, {}, ['1']);
      assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
      assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_(?:RECOVERED|RECOVERY_FAILED)/u);
      if (reviewedOld) {
        assert.equal(statSync(join(root, 'public_html/apps/shared')).mode & 0o777, 0o755);
        assert.equal(statSync(join(root, 'public_html/apps/shared')).ino, reviewedOldInode);
        assert.deepEqual(readdirSync(join(root, 'public_html/apps/shared')).sort(), [...reviewedOld.keys()].sort());
        for (const [name, bytes] of reviewedOld) {
          assert.deepEqual(readFileSync(join(root, `public_html/apps/shared/${name}`)), bytes);
        }
      } else {
        assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
      }
    });
  }
});

test('absent rollback recovery never republishes an invalid private slot at a crash boundary', () => {
  const { root, transport } = setup('absent');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-noreplace-same-inode-bytes-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recoveryCrash = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-noreplace-recovery-safe-crash',
  }, ['0']);
  assert.equal(recoveryCrash.status, 86, recoveryCrash.stderr || recoveryCrash.stdout);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
});

test('rollback recovery reverses present and absent mutations before validating restored live state', async (context) => {
  for (const [original, fault] of [
    ['present', 'rollback-exchange-same-inode-bytes-crash'],
    ['present', 'rollback-exchange-symlink-crash'],
    ['present', 'rollback-exchange-fifo-crash'],
    ['present', 'rollback-exchange-special-crash'],
    ['present', 'rollback-exchange-wrong-mode-crash'],
    ['absent', 'rollback-noreplace-same-inode-bytes-crash'],
    ['absent', 'rollback-noreplace-symlink-crash'],
    ['absent', 'rollback-noreplace-fifo-crash'],
    ['absent', 'rollback-noreplace-special-crash'],
    ['absent', 'rollback-noreplace-wrong-mode-crash'],
  ]) {
    await context.test(`${original}-${fault}`, () => {
      const { root, transport } = setup(original);
      const promoted = runHelper(root, 'promote-next', transport);
      assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
      const reviewedNew = newBytes(transport);
      const reviewedNewInode = statSync(join(root, 'public_html/apps/.htaccess')).ino;
      const crashed = runHelper(root, 'rollback-next', transport, {
        CABOHEALTH_TEST_FAULT: fault,
      }, ['0']);
      assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
      const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
      assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
      assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_(?:RECOVERED|RECOVERY_FAILED)/u);
      if (original === 'present') {
        assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedNew);
        assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).mode & 0o777, 0o644);
        assert.equal(statSync(join(root, 'public_html/apps/.htaccess')).ino, reviewedNewInode);
      } else {
        assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
      }
    });
  }
});

test('directory rollback recovery handles wrong-tree and wrong-mode exchange and no-replace operands', async (context) => {
  for (const [original, fault] of [
    ['present', 'rollback-exchange-wrong-tree-crash'],
    ['present', 'rollback-exchange-directory-wrong-mode-crash'],
    ['absent', 'rollback-noreplace-wrong-tree-crash'],
    ['absent', 'rollback-noreplace-directory-wrong-mode-crash'],
  ]) {
    await context.test(`${original}-${fault}`, () => {
      const { root, transport } = setup('absent');
      if (original === 'present') {
        for (const name of ['logo.png', 'motion.js', 'shell.js', 'styles.css']) {
          writePath(root, `public_html/apps/shared/${name}`, `reviewed old ${name}\n`);
        }
      }
      assert.equal(runHelper(root, 'promote-next', transport).status, 0);
      assert.equal(runHelper(root, 'promote-next', transport).status, 0);
      const reviewedNew = original === 'present'
        ? new Map(['logo.png', 'motion.js', 'shell.js', 'styles.css'].map((name) => [
          name,
          readFileSync(join(root, `public_html/apps/shared/${name}`)),
        ]))
        : null;
      const reviewedNewInode = original === 'present'
        ? statSync(join(root, 'public_html/apps/shared')).ino
        : null;
      const crashed = runHelper(root, 'rollback-next', transport, {
        CABOHEALTH_TEST_FAULT: fault,
      }, ['1']);
      assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
      const recovered = runHelper(root, 'rollback-next', transport, {}, ['1']);
      assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
      assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_(?:RECOVERED|RECOVERY_FAILED)/u);
      if (reviewedNew) {
        assert.equal(statSync(join(root, 'public_html/apps/shared')).ino, reviewedNewInode);
        assert.equal(statSync(join(root, 'public_html/apps/shared')).mode & 0o777, 0o755);
        assert.deepEqual(readdirSync(join(root, 'public_html/apps/shared')).sort(), [...reviewedNew.keys()].sort());
        for (const [name, bytes] of reviewedNew) {
          assert.deepEqual(readFileSync(join(root, `public_html/apps/shared/${name}`)), bytes);
        }
      } else {
        assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
      }
    });
  }
});

test('present promotion recovery follows a relocated restore inode and uniquely quarantines unknown live bytes', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  const reviewedNewInode = statSync(stagePath).ino;
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-quarantined-source-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;
  assert.notEqual(unknownLiveInode, reviewedOldInode);
  assert.notEqual(unknownLiveInode, reviewedNewInode);

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-recovery-relocate-restore-to-slot',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(statSync(stagePath).ino, reviewedNewInode);
  assert.equal(existsSync(slotPath), false);
  assertInodeQuarantined(root, transport, unknownLiveInode);

  const quarantineCount = quarantinePaths(root, transport).length;
  const repeated = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(repeated.status, 1, repeated.stderr || repeated.stdout);
  assert.match(repeated.stderr, /ROLLBACK_NOTHING_PROMOTED/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(statSync(stagePath).ino, reviewedNewInode);
  assert.equal(quarantinePaths(root, transport).length, quarantineCount);
});

test('present rollback recovery follows a relocated restore inode and rebuilds the promoted topology', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const reviewedNewInode = statSync(livePath).ino;
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-exchange-quarantined-destination-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;
  assert.notEqual(unknownLiveInode, reviewedOldInode);
  assert.notEqual(unknownLiveInode, reviewedNewInode);

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-recovery-relocate-restore-to-stage',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedNewInode);
  assert.equal(existsSync(stagePath), false);
  assert.equal(statSync(slotPath).ino, reviewedOldInode);
  assertInodeQuarantined(root, transport, unknownLiveInode);
});

test('absent promotion no-replace recovery re-probes after the live operand moves into the fixed slot', () => {
  const { root, transport } = setup('absent');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-noreplace-same-inode-bytes-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-noreplace-recovery-relocate-live-to-slot',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(existsSync(livePath), false);
  assert.equal(existsSync(stagePath), false);
  assert.equal(existsSync(slotPath), false);
  assertInodeQuarantined(root, transport, unknownLiveInode);
});

test('absent rollback no-replace recovery re-probes when the fixed slot moves live after the absence check', () => {
  const { root, transport } = setup('absent');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-noreplace-same-inode-bytes-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownSlotInode = statSync(slotPath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-noreplace-recovery-relocate-slot-to-live',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(existsSync(livePath), false);
  assert.equal(existsSync(stagePath), false);
  assert.equal(existsSync(slotPath), false);
  assertInodeQuarantined(root, transport, unknownSlotInode);
});

test('compound inverse and quarantine durability failures report both causes after restoring safe live bytes', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  const reviewedNewInode = statSync(stagePath).ino;
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-quarantined-source-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-recovery-relocate-restore-compound-fsync',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /PRIMARY=.*ATOMIC_RENAME_EXCHANGE_FAILED/u);
  assert.match(recovered.stderr, /RECOVERY=.*INJECTED_RECOVERY_QUARANTINE_FSYNC_OSERROR/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(statSync(stagePath).ino, reviewedNewInode);
  assertInodeQuarantined(root, transport, unknownLiveInode);
});

test('recovery resumes after a hard stop immediately after unique private publication', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  const reviewedNewInode = statSync(stagePath).ino;
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-quarantined-source-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;
  const recoveryCrash = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-recovery-relocate-restore-quarantine-crash',
  }, ['0']);
  assert.equal(recoveryCrash.status, 86, recoveryCrash.stderr || recoveryCrash.stdout);
  assert.equal(existsSync(livePath), false);

  const resumed = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(resumed.status, 1, resumed.stderr || resumed.stdout);
  assert.match(resumed.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(statSync(stagePath).ino, reviewedNewInode);
  assert.equal(existsSync(slotPath), false);
  assertInodeQuarantined(root, transport, unknownLiveInode);
});

test('round5 recovery reconciles a promotion restore relocated immediately before its precheck', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  const reviewedNewInode = statSync(stagePath).ino;
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-quarantined-source-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-recovery-relocate-restore-before-precheck',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /PRIMARY=.*RESTORE_OPERAND_INVALID/u);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(statSync(stagePath).ino, reviewedNewInode);
  assert.equal(existsSync(slotPath), false);
  assertInodeQuarantined(root, transport, unknownLiveInode);
});

test('round5 recovery reconciles a rollback restore relocated immediately before its precheck', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const reviewedNewInode = statSync(livePath).ino;
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-exchange-quarantined-destination-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-recovery-relocate-restore-before-precheck',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /PRIMARY=.*RESTORE_OPERAND_INVALID/u);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedNewInode);
  assert.equal(existsSync(stagePath), false);
  assert.equal(statSync(slotPath).ino, reviewedOldInode);
  assertInodeQuarantined(root, transport, unknownLiveInode);
});

test('round5 recovery reconciles an unknown slot relocated live immediately before the absence precheck', () => {
  const { root, transport } = setup('absent');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-noreplace-same-inode-bytes-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownSlotInode = statSync(slotPath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-noreplace-recovery-relocate-slot-before-absence-precheck',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /PRIMARY=.*LIVE_ABSENCE_INVALID/u);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(existsSync(livePath), false);
  assert.equal(existsSync(stagePath), false);
  assert.equal(existsSync(slotPath), false);
  assertInodeQuarantined(root, transport, unknownSlotInode);
});

test('round5 recovery makes a successful promotion inverse with invalid private residue restart-idempotent', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-same-inode-bytes-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(existsSync(stagePath), false);
  assertInodeQuarantined(root, transport, unknownLiveInode);

  const quarantineCount = quarantinePaths(root, transport).length;
  const repeated = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(repeated.status, 1, repeated.stderr || repeated.stdout);
  assert.match(repeated.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(existsSync(stagePath), false);
  assert.equal(quarantinePaths(root, transport).length, quarantineCount);
});

test('round5 recovery makes a successful rollback inverse with invalid private residue restart-idempotent', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const slotPath = join(root, 'rollback', transport.releaseId, '00-apps-htaccess');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const reviewedNewInode = statSync(livePath).ino;
  const crashed = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'rollback-exchange-same-inode-bytes-crash',
  }, ['0']);
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedNewInode);
  assert.equal(existsSync(stagePath), false);
  assert.equal(existsSync(slotPath), false);
  assertInodeQuarantined(root, transport, unknownLiveInode);

  const quarantineCount = quarantinePaths(root, transport).length;
  const repeated = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(repeated.status, 1, repeated.stderr || repeated.stdout);
  assert.match(repeated.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, reviewedNewInode);
  assert.equal(existsSync(stagePath), false);
  assert.equal(existsSync(slotPath), false);
  assert.equal(quarantinePaths(root, transport).length, quarantineCount);
});

test('round5 recovery never decides safety from a stale snapshot after the final probe fails', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const reviewedOldInode = statSync(livePath).ino;
  const reviewedNewInode = statSync(stagePath).ino;
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-quarantined-source-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const unknownLiveInode = statSync(livePath).ino;

  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-recovery-final-probe-oserror',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERY_FAILED/u);
  assert.match(recovered.stderr, /INJECTED_RECOVERY_FINAL_PROBE_OSERROR/u);
  assert.equal(statSync(livePath).ino, reviewedOldInode);
  assert.equal(statSync(stagePath).ino, reviewedNewInode);
  assertInodeQuarantined(root, transport, unknownLiveInode);
});

test('round5 recovery relocates wrong reviewed live bytes when the desired live inode is authorized elsewhere', () => {
  const { root, transport } = setup('present');
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const rollbackPath = join(root, 'rollback', transport.releaseId);
  const slotPath = join(rollbackPath, '00-apps-htaccess');
  assert.equal(runHelper(root, 'promote-next', transport).status, 0);
  const desiredLiveInode = statSync(livePath).ino;
  const desiredSlotInode = statSync(slotPath).ino;
  renameSync(livePath, stagePath);
  renameSync(slotPath, livePath);
  writeFileSync(slotPath, 'unknown private bytes\n', { flag: 'wx', mode: 0o644 });
  const unknownSlotInode = statSync(slotPath).ino;
  writeFileSync(
    join(rollbackPath, '00-apps-htaccess.quarantine-11111111111111111111111111111111'),
    'existing private residue\n',
    { flag: 'wx', mode: 0o600 },
  );

  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(statSync(livePath).ino, desiredLiveInode);
  assert.equal(existsSync(stagePath), false);
  assert.equal(statSync(slotPath).ino, desiredSlotInode);
  assertInodeQuarantined(root, transport, unknownSlotInode);
});

test('round5 recovery does not preserve reviewed live bytes when the authorized topology requires absence', () => {
  const { root, transport } = setup('absent');
  const prepared = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-post-noreplace-oserror',
  });
  assert.equal(prepared.status, 1, prepared.stderr || prepared.stdout);
  const livePath = join(root, 'public_html/apps/.htaccess');
  const stagePath = join(root, 'stage', transport.releaseId, 'public_html/apps/.htaccess');
  const rollbackPath = join(root, 'rollback', transport.releaseId);
  const desiredStageInode = statSync(stagePath).ino;
  mkdirSync(join(root, 'public_html/apps'), { recursive: true, mode: 0o755 });
  renameSync(stagePath, livePath);
  writeFileSync(stagePath, 'unknown private bytes\n', { flag: 'wx', mode: 0o644 });
  const unknownStageInode = statSync(stagePath).ino;
  writeFileSync(
    join(rollbackPath, '00-apps-htaccess.quarantine-22222222222222222222222222222222'),
    'existing private residue\n',
    { flag: 'wx', mode: 0o600 },
  );

  const recovered = runHelper(root, 'rollback-next', transport, {}, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
  assert.equal(existsSync(livePath), false);
  assert.equal(statSync(stagePath).ino, desiredStageInode);
  assertInodeQuarantined(root, transport, unknownStageInode);
});

test('substitution during recovery is detected and quarantined without leaving unknown bytes live', () => {
  const { root, transport } = setup('present');
  writePath(root, `stage/${transport.releaseId}/public_html/apps/fault-substitute`, 'first unknown operand\n');
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-substitute-source-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recovered = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-recovery-destination-same-inode-mutation',
  }, ['0']);
  assert.equal(recovered.status, 1, recovered.stderr || recovered.stdout);
  assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERY_FAILED/u);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
});

test('recovery-time destination mutation is quarantined before the next injected hard crash', () => {
  const { root, transport } = setup('present');
  writePath(root, `stage/${transport.releaseId}/public_html/apps/fault-substitute`, 'first unknown operand\n');
  const crashed = runHelper(root, 'promote-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promote-exchange-substitute-source-crash',
  });
  assert.equal(crashed.status, 86, crashed.stderr || crashed.stdout);
  const recoveryCrash = runHelper(root, 'rollback-next', transport, {
    CABOHEALTH_TEST_FAULT: 'promotion-recovery-destination-mutation-safe-crash',
  }, ['0']);
  assert.equal(recoveryCrash.status, 86, recoveryCrash.stderr || recoveryCrash.stdout);
  assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
});

test('operation lock bootstrap survives every private-candidate durability boundary under a strict umask', async (context) => {
  const faults = [
    'operation-lock-crash-after-candidate-create',
    'operation-lock-crash-after-candidate-fchmod',
    ...Array.from({ length: operationLockBytes.length + 1 }, (_unused, offset) => `operation-lock-crash-after-byte-${offset}`),
    'operation-lock-crash-after-candidate-write',
    'operation-lock-crash-after-candidate-fsync',
    'operation-lock-crash-after-publish',
    'operation-lock-crash-after-directory-fsync',
  ];
  for (const fault of faults) {
    await context.test(fault, () => {
      const { root, transport } = setup('absent');
      for (const container of ['apps', 'app', '.well-known']) {
        mkdirSync(join(root, 'public_html', container), { mode: 0o755 });
      }
      const transitions = join(root, 'rollback', transport.releaseId, 'transitions');
      mkdirSync(transitions, { recursive: true, mode: 0o700 });
      const priorUmask = process.umask(0o777);
      let crashed;
      try {
        crashed = runHelper(root, 'promote-next', transport, { CABOHEALTH_TEST_FAULT: fault });
      } finally {
        process.umask(priorUmask);
      }
      assert.equal(crashed.status, 86, `${fault}\n${crashed.stderr || crashed.stdout}`);
      const lockPath = join(transitions, 'operation.lock');
      const published = fault === 'operation-lock-crash-after-publish'
        || fault === 'operation-lock-crash-after-directory-fsync';
      assert.equal(existsSync(lockPath), published);
      const resumed = runHelper(root, 'promote-next', transport);
      assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
      assert.equal(statSync(lockPath).mode & 0o777, 0o600);
      assert.deepEqual(readFileSync(lockPath), operationLockBytes);
      for (const name of readdirSync(transitions).filter((entry) => entry.startsWith('operation-lock-'))) {
        assert.match(name, /^operation-lock-[a-f0-9]{32}\.candidate$/u);
        assert.equal([0o000, 0o200, 0o400, 0o600].includes(statSync(join(transitions, name)).mode & 0o777), true);
      }
    });
  }
});

test('concurrent private lock candidates publish one authority and serialize on that inode', async () => {
  const { root, transport } = setup('absent');
  const spawnCommand = (fault) => {
    const child = spawn('python3', [helperPath, 'promote-next', root, transport.releaseId], {
      cwd: projectRoot,
      env: { ...process.env, CABOHEALTH_TEST_FAULT: fault },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(canonicalJson(transport));
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    return {
      child,
      result: new Promise((resolvePromise) => child.on('close', (status) => resolvePromise({
        status,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      }))),
    };
  };
  const first = spawnCommand('operation-lock-hold-before-publish');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  const second = spawnCommand('operation-lock-hold');
  const [firstResult, secondResult] = await Promise.all([first.result, second.result]);
  const results = [firstResult, secondResult];
  assert.equal(results.filter(({ status }) => status === 0).length, 1, JSON.stringify(results));
  const busy = results.find(({ status }) => status === 1);
  assert.ok(busy, JSON.stringify(results));
  assert.match(busy.stderr, /PROMOTION_OPERATION_BUSY/u);
  const lockPath = join(root, 'rollback', transport.releaseId, 'transitions/operation.lock');
  assert.equal(statSync(lockPath).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(lockPath), operationLockBytes);
  assert.equal(existsSync(join(root, 'public_html/apps/shared')), false);
});
