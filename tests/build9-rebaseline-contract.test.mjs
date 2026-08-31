import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const CURRENT_DOCUMENT_REVIEW_ALLOWLIST = Object.freeze([
  'release/app-store/3.0/release-manifest.json',
  'release/app-store/3.0/en-US.md',
  'release/app-store/3.0/es-MX.md',
  'release/app-store/3.0/review-notes.md',
  'release/app-store/3.0/testflight-what-to-test.md',
  'release/app-store/3.0/submission-gates.md',
  'release/app-store/3.0/screenshots-manifest.json',
  'release/app-store/3.0/screenshots/storyboard.md',
  'release/app-store/3.0/apple-review-remediation-2026-08-24.md',
  'release/app-store/3.0/age-rating.md',
  'release/app-store/3.0/app-privacy.md',
  'release/app-store/3.0/accessibility-nutrition-label-evidence.md',
  'release/app-store/3.0/content-rights-inventory.md',
  'release/data-inventory.md',
  'release/compliance-facts.json',
  'docs/operations/apple-post-build-evidence.md',
  'docs/operations/exact-ios-ipa-audit.md',
  'docs/operations/prior-apple-review-resolution.md',
  'docs/operations/native-firebase-runtime.md',
  'docs/operations/dynamic-miniapp-catalog.md',
  'docs/operations/dynamic-miniapp-production-activation-2026-08-25.md',
  'docs/operations/protected-overlay-dynamic-activation-2026-08-26.md',
  'docs/operations/vip-showcase-production-activation-2026-08-26.md',
  'tools/app-store-submit-adapter/README.md',
  'tools/app-store-submit-adapter/package.json',
]);

const BUILD_8_REFERENCE = /\b(?:build[- /]?8|builds\s+4[–-]8)\b|["']buildNumber["']\s*:\s*["']8["']/giu;
const HISTORICAL_BUILD_8_CONTEXT = /\b(?:immutable|histor(?:y|ical)|obsolete(?:-source)?|subsequently|introduced|preserv(?:e|ed|es|ing)|added|verified before|not current authority|cannot authorize|was (?:then )?built|complete)\b/iu;
const STALE_BUILD_8_AUTHORITY = [
  /\bbuild[- /]?8\s+(?:is|remains|will be)\s+(?:the\s+)?(?:sole\s+unbuilt|next|current|pending)\b/iu,
  /\b(?:sole\s+unbuilt|next|current)\s+(?:release\s+)?candidate\s+(?:is\s+)?(?:3\.0\/)?build[- /]?8\b/iu,
  /\bpending\s+(?:exact\s+)?(?:3\.0\/)?build[- /]?8\b/iu,
];

test('the sole current candidate is 3.0 build 9 with no current phase authority', () => {
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  const config = readFileSync(join(root, 'constants/config.ts'), 'utf8');
  const guard = readFileSync(join(root, 'scripts/release-command-guard.mjs'), 'utf8');
  const manifest = JSON.parse(readFileSync(
    join(root, 'release/app-store/3.0/release-manifest.json'),
    'utf8',
  ));

  assert.equal(app.expo.version, '3.0');
  assert.equal(app.expo.ios.buildNumber, '9');
  assert.match(config, /buildNumber:\s*'9'/u);
  assert.equal(manifest.candidate.buildNumber, '9');
  for (const pin of [
    'BUILD_INPUT_ATTESTATION_SHA256',
    'BUILD_ARTIFACT_ATTESTATION_SHA256',
    'RC_ATTESTATION_SHA256',
    'PINNED_EAS_CLI',
    'PINNED_APP_STORE_SUBMIT_ADAPTER',
  ]) assert.match(guard, new RegExp(`^const ${pin} = null;$`, 'mu'));
  assert.equal(existsSync(join(root, 'release/app-store/3.0/build-input-attestation.json')), false);
  assert.equal(existsSync(join(root, 'release/app-store/3.0/build-artifact-attestation.json')), false);
  assert.equal(existsSync(join(root, 'release/app-store/3.0/rc-attestation.json')), false);
});

test('build 8 authority is immutable hash-bound history and never current build 9 authority', () => {
  const history = join(root, 'release/app-store/3.0/history/build-8');
  const inputBytes = readFileSync(join(history, 'build-input-attestation.json'));
  const artifactBytes = readFileSync(join(history, 'build-artifact-attestation.json'));
  const manifest = JSON.parse(readFileSync(join(history, 'manifest.json'), 'utf8'));

  assert.equal(sha256(inputBytes), 'f4ee8c3da75be23d300b816495649c414f2900efaef9e88294bdc52824c3ed8e');
  assert.equal(sha256(artifactBytes), '966e00960c688ec1d0299dae36b6eff599f1286c20c218b434720bdd882ab4cb');
  assert.deepEqual(manifest.candidate, { marketingVersion: '3.0', buildNumber: '8' });
  assert.equal(manifest.status, 'obsolete-source-history');
  assert.equal(manifest.buildInputAttestation.sha256, sha256(inputBytes));
  assert.equal(manifest.buildArtifactAttestation.sha256, sha256(artifactBytes));
  assert.equal(manifest.frozenSource.commit, '288ff2185c46fee117555ae0842a4a63c34df938');
  assert.equal(manifest.frozenSource.sha256, 'a36b34e28d26032ae71e4bc61f767423774faa90873551e0cabbbbfcb310374b');
  assert.equal(manifest.easArtifactAssociation.buildId, '9f0e9405-9e2a-4900-9f06-558d7c790c67');
  assert.equal(manifest.easArtifactAssociation.ipaSha256, '419b9e2da17e04161c396f746330907906f7f743c05e313b4ebda09cccc91e4c');
  assert.equal(manifest.easArtifactAssociation.associationGuardProven, false);
  assert.equal(manifest.easSubmission.submissionId, 'c06b252d-422b-4271-9473-29683b5fe9b5');
  assert.equal(manifest.appleObservation.uploadStatus, 'Complete');
  assert.equal(manifest.appleObservation.processingStatus, 'Ready to Submit');
  assert.equal(manifest.appleObservation.internalGroupAvailable, true);
  assert.equal(manifest.rcAttestation.status, 'never-created');

  assert.equal(JSON.parse(inputBytes).candidate.buildNumber, '8');
  assert.equal(JSON.parse(artifactBytes).candidate.buildNumber, '8');
});

test('every build-8 reference in the current-document allowlist is classified as history', () => {
  let classifiedReferenceCount = 0;
  for (const relativePath of CURRENT_DOCUMENT_REVIEW_ALLOWLIST) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const references = [...source.matchAll(BUILD_8_REFERENCE)];
    if (relativePath === 'release/app-store/3.0/release-manifest.json') {
      assert.equal(references.length, 3, 'release manifest build-8 references drifted');
      const manifest = JSON.parse(source);
      assert.equal(manifest.candidate.buildNumber, '9');
      assert.equal(manifest.ascEvidence.inspectionMode, 'read-only');
      assert.equal(manifest.ascEvidence.observedAt, '2026-08-27T20:35:04.000Z');
      assert.equal(manifest.ascEvidence.nextCandidateBuild, '8');
      const historical = manifest.historicalCandidateEvidence.filter(
        ({ marketingVersion, buildNumber }) => marketingVersion === '3.0' && buildNumber === '8',
      );
      assert.deepEqual(historical, [{
        marketingVersion: '3.0',
        buildNumber: '8',
        status: 'testflight-ready-to-submit-internal-available-obsolete-source',
        appStoreObserved: true,
        trackedHistoryRoot: 'release/app-store/3.0/history/build-8',
        privateHistoryRoot: 'release/private/rc-build-8',
      }]);
      classifiedReferenceCount += references.length + 1;
      continue;
    }

    if (relativePath.endsWith('.json')) {
      assert.equal(references.length, 0, `${relativePath} must not contain build-8 authority`);
      continue;
    }
    for (const reference of references) {
      const paragraphStart = source.lastIndexOf('\n\n', reference.index) + 2;
      const nextBreak = source.indexOf('\n\n', reference.index);
      const paragraph = source.slice(
        paragraphStart,
        nextBreak === -1 ? source.length : nextBreak,
      );
      assert.match(
        paragraph,
        HISTORICAL_BUILD_8_CONTEXT,
        `${relativePath}: ${reference[0]} lacks historical classification`,
      );
      for (const stalePattern of STALE_BUILD_8_AUTHORITY) {
        assert.doesNotMatch(
          paragraph,
          stalePattern,
          `${relativePath}: ${reference[0]} is stale current/future authority`,
        );
      }
      classifiedReferenceCount += 1;
    }
  }
  assert.ok(classifiedReferenceCount > 0, 'allowlist must retain classified build-8 history');
});

test('current package actions route through the durable runner and separate group guard actions', () => {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts['build:prod'], 'node scripts/release-attempt-runner.mjs start build');
  assert.equal(
    scripts['upload:testflight'],
    'node scripts/release-attempt-runner.mjs start upload-testflight',
  );
  assert.equal(
    scripts['observe:testflight:internal'],
    'node scripts/release-command-guard.mjs observe-testflight-internal',
  );
  assert.equal(
    scripts['assign:testflight:internal'],
    'node scripts/release-command-guard.mjs assign-testflight-internal',
  );
});
