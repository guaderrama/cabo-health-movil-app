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
      assert.match(recovered.stderr, /OPERAND_SUBSTITUTION_RECOVERED/u);
      if (reviewedOld) assert.deepEqual(readFileSync(join(root, 'public_html/apps/.htaccess')), reviewedOld);
      else assert.equal(existsSync(join(root, 'public_html/apps/.htaccess')), false);
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
