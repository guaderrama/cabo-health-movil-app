import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function currentAuthorityPins(guard) {
  const optionalPin = (name, pattern) => {
    const value = guard.match(
      new RegExp(`^const ${name} = (null|'${pattern}');$`, 'mu'),
    )?.[1];
    assert.ok(value, `${name} must use one exact reviewed literal`);
    return value === 'null' ? null : value.slice(1, -1);
  };
  return {
    buildInputPin: optionalPin('BUILD_INPUT_ATTESTATION_SHA256', '[a-f0-9]{64}'),
    buildArtifactPin: optionalPin('BUILD_ARTIFACT_ATTESTATION_SHA256', '[a-f0-9]{64}'),
    rcPin: optionalPin('RC_ATTESTATION_SHA256', '[a-f0-9]{64}'),
    easPin: optionalPin('PINNED_EAS_CLI', '[A-Za-z0-9+/]+={0,2}'),
    adapterPin: optionalPin('PINNED_APP_STORE_SUBMIT_ADAPTER', '[A-Za-z0-9+/]+={0,2}'),
  };
}

function withAuthorityPin(guard, name, value) {
  const declaration = new RegExp(`^const ${name} = [^\r\n]*;$`, 'mu');
  assert.match(guard, declaration, `${name} fixture must target one declaration`);
  return guard.replace(declaration, `const ${name} = ${value};`);
}

function assertBuild12AuthorityPhase({ guard, attestations }) {
  const {
    buildInputPin,
    buildArtifactPin,
    rcPin,
    easPin,
    adapterPin,
  } = currentAuthorityPins(guard);
  const phases = [
    ['input', buildInputPin, attestations.input, true],
    ['artifact', buildArtifactPin, attestations.artifact, true],
    ['rc', rcPin, attestations.rc, true],
    ['submit-tool', adapterPin, null, false],
  ];
  assert.equal(easPin, null, 'the legacy EAS CLI pin must remain null in every phase');

  let firstPending = phases.length;
  for (let index = 0; index < phases.length; index += 1) {
    if (phases[index][1] === null) {
      firstPending = index;
      break;
    }
  }
  for (let index = 0; index < phases.length; index += 1) {
    const [phase, pin, bytes, requiresAttestation] = phases[index];
    if (index < firstPending) {
      assert.notEqual(pin, null, `${phase} requires its reviewed pin`);
      if (requiresAttestation) {
        assert.notEqual(bytes, null, `${phase} requires its attestation bytes`);
        assert.equal(sha256(bytes), pin, `${phase} pin must bind exact bytes`);
      }
    } else {
      assert.equal(pin, null, `${phase} and every later phase must remain unpinned`);
      if (bytes !== null) assert.fail(`${phase} evidence cannot precede its reviewed pin`);
    }
  }
  return phases[firstPending - 1]?.[0] ?? 'pre-input';
}

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

const BUILD_8_REFERENCE = /\b(?:build[- /]?8|builds\s+4[–-]8)\b|["']buildNumber["']\s*:\s*["']8["']|\bbuild\s+number\s*:\s*`8`/giu;
const HISTORICAL_BUILD_8_CONTEXT = /\b(?:immutable|histor(?:y|ical)|obsolete(?:-source)?|subsequently|introduced|preserv(?:e|ed|es|ing)|added|verified before|not current authority|cannot authorize|was (?:then )?built|complete)\b/iu;
const STALE_BUILD_8_AUTHORITY = [
  /\bbuild[- /]?8\s+(?:is|remains|will be)\s+(?:the\s+)?(?:sole\s+unbuilt|next|current|pending)\b/iu,
  /\b(?:sole\s+unbuilt|next|current)\s+(?:release\s+)?candidate\s+(?:is\s+)?(?:3\.0\/)?build[- /]?8\b/iu,
  /\bpending\s+(?:exact\s+)?(?:3\.0\/)?build[- /]?8\b/iu,
];
const BUILD_9_REFERENCE = /\bbuild[- /]?9\b|["']buildNumber["']\s*:\s*["']9["']|\bbuild\s+number\s*:\s*`9`/giu;
const HISTORICAL_BUILD_9_CONTEXT = /\b(?:aborted|histor(?:y|ical)|pre-provider|never repin|do not reuse|cannot authorize|no provider operation)\b/iu;
const STALE_BUILD_9_AUTHORITY = [
  /\bbuild[- /]?9\s+(?:is|remains|will be)\s+(?:the\s+)?(?:sole\s+unbuilt|next|current|pending)\b/iu,
  /\b(?:sole\s+unbuilt|next|current)\s+(?:release\s+)?candidate\s+(?:is\s+)?(?:3\.0\/)?build[- /]?9\b/iu,
  /\bpending\s+(?:exact\s+)?(?:3\.0\/)?build[- /]?9\b/iu,
];
const BUILD_10_PROSE_REFERENCE = /\bbuild[- /]?10\b/giu;
const BUILD_10_STRUCTURED_REFERENCE = /["']buildNumber["']\s*:\s*["']10["']|\bbuild\s+number\s*:\s*`10`/giu;
const BUILD_10_REFERENCE = new RegExp(
  `${BUILD_10_PROSE_REFERENCE.source}|${BUILD_10_STRUCTURED_REFERENCE.source}`,
  'giu',
);
const HISTORICAL_BUILD_10_CONTEXT = /\b(?:processed(?:[- ]internal)?[- ]testflight|processed\s+build[- /]?10\s+authority|immutable|histor(?:y|ical)|cannot authorize|(?:was\s+subsequently\s+)?built,\s+attested,\s+uploaded,\s+and\s+processed)\b/iu;
const STALE_BUILD_10_AUTHORITY = [
  /\bbuild[- /]?10\s+(?:is|remains|will be|input freeze|input-attested)\s+(?:the\s+)?(?:sole\s+unbuilt|next|current|pending)\b/iu,
  /\b(?:sole\s+unbuilt|next|current)\s+(?:release\s+)?candidate\s+(?:is\s+)?(?:3\.0\/)?build[- /]?10\b/iu,
  /\bpending\s+(?:exact\s+)?(?:3\.0\/)?build[- /]?10\b/iu,
  /\bbuild[- /]?10\s*,\s*physical-device QA,\s*and current release evidence remain pending\b/iu,
];
const BUILD_11_PROSE_REFERENCE = /\bbuild[- /]?11\b/giu;
const HISTORICAL_BUILD_11_CONTEXT = /\b(?:archived|before upload|built and exactly attested|cannot authorize|EAS-finished|histor(?:y|ical)|immutable|invalidated|non-uploaded|preserv(?:e|ed|es|ing))\b/iu;
const STALE_BUILD_11_AUTHORITY = [
  /\bbuild[- /]?11\s+(?:is|remains|will be)\s+(?:the\s+)?(?:sole\s+unbuilt|next|current|pending)\b/iu,
  /\b(?:sole\s+unbuilt|next|current)\s+(?:release\s+)?candidate\s+(?:is\s+)?(?:3\.0\/)?build[- /]?11\b/iu,
  /\b(?:3\.0\/)?build[- /]?11\s+is\s+the\s+current\s+candidate\b/iu,
  /\bbuild[- /]?11\s+freeze requirements\b/iu,
];
const BUILD_12_SDD_ROOT = '/.superpowers/sdd/2026-09-04-cabohealth-build12-post-artifact-recovery';
const BUILD_12_PHASE_TRUTH_PATHS = Object.freeze([
  'release/app-store/3.0/submission-gates.md',
  'release/app-store/3.0/apple-review-remediation-2026-08-24.md',
  'release/data-inventory.md',
  'docs/operations/prior-apple-review-resolution.md',
  'docs/operations/dynamic-miniapp-catalog.md',
  'docs/operations/dynamic-miniapp-production-activation-2026-08-25.md',
  'docs/operations/protected-overlay-dynamic-activation-2026-08-26.md',
  'docs/operations/vip-showcase-production-activation-2026-08-26.md',
]);
const BUILD_12_PHASE_NEUTRAL_CONTEXT = /live\s+authority\s+phase(?:\s|&mdash;|—|-)*pre-input,\s+input,\s+artifact,\s+RC,\s+or\s+submit-tool(?:\s|&mdash;|—|-)*must\s+be\s+determined\s+from\s+the\s+exact\s+current\s+pins\s+and\s+required\s+attestation\s+bytes/iu;
const STALE_BUILD_12_PHASE_ASSERTIONS = Object.freeze([
  /\bbuild[- /]?12\b[^.]{0,120}\bsole unbuilt\b/iu,
  /\bsole unbuilt\b[^.]{0,120}\bbuild[- /]?12\b/iu,
  /\bcurrent build-?12\b[^.]{0,100}\b(?:authority|attestation|IPA|TestFlight upload)\b[^.]{0,80}\b(?:absent|does not exist)\b/iu,
  /\bno current build-?12\b[^.]{0,100}\b(?:authority|attestation|IPA|TestFlight upload)\b/iu,
  /\bbuild[- /]?12\b[^.]{0,100}\bbuild-input authority\b[^.]{0,80}\bremain(?:s)? pending\b/iu,
  /\bexact 3\.0\/build 12 signed RC\b[^.]{0,180}\bstill pending\b/iu,
  /\bbuild 12 input freeze\b[^.]{0,240}\bremain pending\b/iu,
  /\[[ ]\][^\n]*\bbuild-12 canonical build-input attestation\b/iu,
]);

function referenceLocalClause(source, referenceIndex) {
  const clauseStart = Math.max(
    source.lastIndexOf('.', referenceIndex),
    source.lastIndexOf(';', referenceIndex),
  ) + 1;
  const followingClause = source.slice(referenceIndex).search(/[.;]/u);
  const clauseEnd = followingClause === -1
    ? source.length
    : referenceIndex + followingClause + 1;
  return source.slice(clauseStart, clauseEnd);
}

function assertBuild10ProseIsHistorical(relativePath, source) {
  const references = [...source.matchAll(BUILD_10_PROSE_REFERENCE)];
  for (const reference of references) {
    const clause = referenceLocalClause(source, reference.index);
    assert.match(
      clause,
      HISTORICAL_BUILD_10_CONTEXT,
      `${relativePath}: ${reference[0]} lacks processed-history classification in its local clause`,
    );
    for (const stalePattern of STALE_BUILD_10_AUTHORITY) {
      assert.doesNotMatch(
        clause,
        stalePattern,
        `${relativePath}: ${reference[0]} is stale current/future authority in its local clause`,
      );
    }
  }
  return references.length;
}

function assertBuild11ProseIsHistorical(relativePath, source) {
  const references = [...source.matchAll(BUILD_11_PROSE_REFERENCE)];
  for (const reference of references) {
    const clause = referenceLocalClause(source, reference.index);
    assert.match(
      clause,
      HISTORICAL_BUILD_11_CONTEXT,
      `${relativePath}: ${reference[0]} lacks non-uploaded-history classification in its local clause`,
    );
    for (const stalePattern of STALE_BUILD_11_AUTHORITY) {
      assert.doesNotMatch(
        clause,
        stalePattern,
        `${relativePath}: ${reference[0]} is stale current/future authority in its local clause`,
      );
    }
  }
  return references.length;
}

test('the refrozen current candidate has one valid contiguous phase while invalidated attempts are separate history', () => {
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  const config = readFileSync(join(root, 'constants/config.ts'), 'utf8');
  const guard = readFileSync(join(root, 'scripts/release-command-guard.mjs'), 'utf8');
  const manifest = JSON.parse(readFileSync(
    join(root, 'release/app-store/3.0/release-manifest.json'),
    'utf8',
  ));

  assert.equal(app.expo.version, '3.0');
  assert.equal(app.expo.ios.buildNumber, '12');
  assert.match(config, /buildNumber:\s*'12'/u);
  assert.equal(manifest.candidate.buildNumber, '12');
  assert.deepEqual(manifest.candidate, {
    appleId: '6758285327',
    bundleIdentifier: 'com.cabohealth.app',
    marketingVersion: '3.0',
    buildNumber: '12',
    status: 'authority-sequence-configured',
    appJsonUpdated: true,
    configUpdated: true,
    liveAuthorityPhaseSource: 'release-command-guard-pins-and-required-attestation-bytes',
  });
  assert.equal(
    manifest.gates.exactReleaseCandidate,
    'build-12-live-phase-defined-by-exact-current-pins-and-required-attestation-bytes',
  );
  assert.equal(
    manifest.gates.testFlight,
    'builds-4-through-8-obsolete-source-build-9-aborted-pre-provider-build-10-processed-internal-testflight-history-build-11-eas-finished-attested-not-uploaded-history-build-12-live-phase-defined-by-exact-current-pins-and-required-attestation-bytes',
  );
  assert.equal(
    manifest.appStoreDraft.unresolvedExternalGates.exactReleaseCandidate,
    'build-12-live-phase-defined-by-exact-current-pins-and-required-attestation-bytes',
  );
  const inputPath = join(root, 'release/app-store/3.0/build-input-attestation.json');
  const artifactPath = join(root, 'release/app-store/3.0/build-artifact-attestation.json');
  const rcPath = join(root, 'release/app-store/3.0/rc-attestation.json');
  const readOptionalAttestation = (path) => (
    existsSync(path) ? readFileSync(path) : null
  );
  assert.match(assertBuild12AuthorityPhase({
    guard,
    attestations: {
      input: readOptionalAttestation(inputPath),
      artifact: readOptionalAttestation(artifactPath),
      rc: readOptionalAttestation(rcPath),
    },
  }), /^(?:pre-input|input|artifact|rc|submit-tool)$/u);
  assert.deepEqual(manifest.historicalInputAuthorityEvidence, [
    {
      attempt: 1,
      status: 'input-attested-invalidated-pre-provider-source-drift',
      trackedHistoryRoot: 'release/app-store/3.0/history/build-11-input-attempt-1-aborted',
      providerOperationInitiated: false,
    },
    {
      attempt: 2,
      status: 'input-attested-invalidated-pre-provider-post-pin-gate-failure',
      trackedHistoryRoot: 'release/app-store/3.0/history/build-11-input-attempt-2-aborted',
      providerOperationInitiated: false,
    },
  ]);
});

test('build 12 authority accepts every contiguous phase and rejects partial or mismatched evidence', () => {
  const guard = readFileSync(join(root, 'scripts/release-command-guard.mjs'), 'utf8');
  const input = Buffer.from('{"phase":"input"}\n');
  const artifact = Buffer.from('{"phase":"artifact"}\n');
  const rc = Buffer.from('{"phase":"rc"}\n');
  const preInputGuard = [
    'BUILD_INPUT_ATTESTATION_SHA256',
    'BUILD_ARTIFACT_ATTESTATION_SHA256',
    'RC_ATTESTATION_SHA256',
    'PINNED_EAS_CLI',
    'PINNED_APP_STORE_SUBMIT_ADAPTER',
  ].reduce((source, name) => withAuthorityPin(source, name, 'null'), guard);
  const inputGuard = withAuthorityPin(
    preInputGuard,
    'BUILD_INPUT_ATTESTATION_SHA256',
    `'${sha256(input)}'`,
  );
  const artifactGuard = withAuthorityPin(
    inputGuard,
    'BUILD_ARTIFACT_ATTESTATION_SHA256',
    `'${sha256(artifact)}'`,
  );
  const rcGuard = withAuthorityPin(artifactGuard, 'RC_ATTESTATION_SHA256', `'${sha256(rc)}'`);
  const submitGuard = withAuthorityPin(rcGuard, 'PINNED_APP_STORE_SUBMIT_ADAPTER', "'QQ=='");
  for (const [expected, phaseGuard, attestations] of [
    ['pre-input', preInputGuard, { input: null, artifact: null, rc: null }],
    ['input', inputGuard, { input, artifact: null, rc: null }],
    ['artifact', artifactGuard, { input, artifact, rc: null }],
    ['rc', rcGuard, { input, artifact, rc }],
    ['submit-tool', submitGuard, { input, artifact, rc }],
  ]) {
    assert.equal(assertBuild12AuthorityPhase({ guard: phaseGuard, attestations }), expected);
  }
  assert.throws(() => assertBuild12AuthorityPhase({
    guard: withAuthorityPin(
      preInputGuard,
      'BUILD_ARTIFACT_ATTESTATION_SHA256',
      `'${sha256(artifact)}'`,
    ),
    attestations: { input: null, artifact, rc: null },
  }), /every later phase must remain unpinned/u);
  assert.throws(() => assertBuild12AuthorityPhase({
    guard: inputGuard,
    attestations: { input: artifact, artifact: null, rc: null },
  }), /input pin must bind exact bytes/u);
  assert.throws(() => assertBuild12AuthorityPhase({
    guard: inputGuard,
    attestations: { input: null, artifact: null, rc: null },
  }), /input requires its attestation bytes/u);
  assert.throws(() => assertBuild12AuthorityPhase({
    guard: artifactGuard,
    attestations: { input, artifact: null, rc: null },
  }), /artifact requires its attestation bytes/u);
  assert.throws(() => assertBuild12AuthorityPhase({
    guard: rcGuard,
    attestations: { input, artifact, rc: null },
  }), /rc requires its attestation bytes/u);
  assert.throws(() => assertBuild12AuthorityPhase({
    guard: withAuthorityPin(guard, 'PINNED_EAS_CLI', "'QQ=='"),
    attestations: { input: null, artifact: null, rc: null },
  }), /legacy EAS CLI pin/u);
});

test('current build 12 prose stays truthful in synthetic input and artifact phases', () => {
  const guard = readFileSync(join(root, 'scripts/release-command-guard.mjs'), 'utf8');
  const input = Buffer.from('{"phase":"input"}\n');
  const artifact = Buffer.from('{"phase":"artifact"}\n');
  const preInputGuard = [
    'BUILD_INPUT_ATTESTATION_SHA256',
    'BUILD_ARTIFACT_ATTESTATION_SHA256',
    'RC_ATTESTATION_SHA256',
    'PINNED_EAS_CLI',
    'PINNED_APP_STORE_SUBMIT_ADAPTER',
  ].reduce((source, name) => withAuthorityPin(source, name, 'null'), guard);
  const inputGuard = withAuthorityPin(
    preInputGuard,
    'BUILD_INPUT_ATTESTATION_SHA256',
    `'${sha256(input)}'`,
  );
  const artifactGuard = withAuthorityPin(
    inputGuard,
    'BUILD_ARTIFACT_ATTESTATION_SHA256',
    `'${sha256(artifact)}'`,
  );
  assert.equal(assertBuild12AuthorityPhase({
    guard: inputGuard,
    attestations: { input, artifact: null, rc: null },
  }), 'input');
  assert.equal(assertBuild12AuthorityPhase({
    guard: artifactGuard,
    attestations: { input, artifact, rc: null },
  }), 'artifact');

  for (const relativePath of BUILD_12_PHASE_TRUTH_PATHS) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.match(
      source,
      BUILD_12_PHASE_NEUTRAL_CONTEXT,
      `${relativePath}: current build-12 prose must defer its phase to live authority`,
    );
    for (const stalePattern of STALE_BUILD_12_PHASE_ASSERTIONS) {
      assert.doesNotMatch(
        source,
        stalePattern,
        `${relativePath}: current build-12 prose is stale after input or artifact authority`,
      );
    }
  }

  for (const relativePath of CURRENT_DOCUMENT_REVIEW_ALLOWLIST) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    if (!/build[- /]?12/iu.test(source)) continue;
    for (const stalePattern of STALE_BUILD_12_PHASE_ASSERTIONS) {
      assert.doesNotMatch(
        source,
        stalePattern,
        `${relativePath}: operational allowlist contains a stale build-12 phase claim`,
      );
    }
  }
});

test('freeze-time metadata documents delegate final live state to RC-bound evidence', () => {
  const manifest = JSON.parse(readFileSync(
    join(root, 'release/app-store/3.0/release-manifest.json'),
    'utf8',
  ));
  const age = JSON.parse(readFileSync(join(root, 'release/app-store/3.0/age-rating.json'), 'utf8'));
  assert.deepEqual(manifest.authoritySemantics, {
    documentRole: 'immutable-freeze-baseline',
    livePhaseSource: 'release-command-guard-pins-and-required-attestation-bytes',
    finalReleaseStateSource: 'rc-attestation-and-bound-private-evidence',
    requiredRcHashBindings: [
      'physicalIphoneQaSha256',
      'screenshotsManifestSha256',
      'appStoreMetadataEvidenceSha256',
      'appPrivacySha256',
      'reviewNotesSha256',
    ],
    postInputMutationAllowed: false,
  });
  assert.deepEqual(age.authoritySemantics, {
    documentRole: 'immutable-freeze-baseline',
    finalSavedResultSource: 'rc-attestation.appStoreMetadataEvidenceSha256',
    postInputMutationAllowed: false,
  });
  for (const relativePath of [
    'release/app-store/3.0/age-rating.md',
    'release/app-store/3.0/accessibility-nutrition-label-evidence.md',
    'release/app-store/3.0/content-rights-and-brand.md',
    'release/app-store/3.0/content-rights-inventory.md',
    'release/app-store/3.0/declarations.md',
    'release/app-store/3.0/submission-gates.md',
  ]) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.match(source, /immutable freeze(?:-time)? baseline/iu, `${relativePath} lacks freeze-baseline semantics`);
    assert.match(source, /RC-bound|RC attestation/iu, `${relativePath} lacks final evidence authority`);
  }
});

test('build 10 is immutable processed internal-TestFlight history with its exact identities', () => {
  const history = join(root, 'release/app-store/3.0/history/build-10');
  const inputBytes = readFileSync(join(history, 'build-input-attestation.json'));
  const artifactBytes = readFileSync(join(history, 'build-artifact-attestation.json'));
  const manifestBytes = readFileSync(join(history, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);

  assert.equal(sha256(inputBytes), '686b7d470361726d0f5394000db7482192584c227b7413a0b750895f19e55be9');
  assert.equal(sha256(artifactBytes), '711bdf720abbdba96961f9c4e18d33c6653a70ec61f7b6474a3251df6d6e95d1');
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '10',
    },
    status: 'processed-internal-testflight-history',
    buildInputAttestation: {
      relativePath: 'build-input-attestation.json',
      sha256: sha256(inputBytes),
    },
    buildArtifactAttestation: {
      relativePath: 'build-artifact-attestation.json',
      sha256: sha256(artifactBytes),
    },
    frozenSource: {
      commit: 'a2fb59e28e3751682275ec8afef586152c800958',
      sourceTreeSha256: '18b1862bbb5d319da608ae43f5c17f7d7868392a1bea16a0c0d1855ab858507c',
    },
    easArtifactAssociation: {
      buildId: 'd1b93fcd-d54a-449d-b956-d5bd4add6d6b',
      ipaSha256: '935d3151b26acb331984ee9c5df83e9171afafea0ea05a1816caf4ece4d96839',
    },
    easSubmission: {
      submissionId: 'ba35a1ee-b89a-4a3b-8d2b-914bdaa0bd29',
    },
    appleObservation: {
      buildResourceId: '3d8b98d8-3b1a-47de-8555-4ac36e0ed46a',
      processingStatus: 'processed-internal-testflight',
    },
  });
  assert.equal(manifestBytes.toString('utf8'), `${JSON.stringify(manifest)}\n`);
  assert.equal(JSON.parse(inputBytes).candidate.buildNumber, '10');
  assert.equal(JSON.parse(artifactBytes).candidate.buildNumber, '10');
});

test('build 8 authority is immutable hash-bound history and never current build 12 authority', () => {
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

test('build 9 input authority is immutable aborted-pre-provider history', () => {
  const history = join(root, 'release/app-store/3.0/history/build-9-aborted');
  const inputBytes = readFileSync(join(history, 'build-input-attestation.json'));
  const manifest = JSON.parse(readFileSync(join(history, 'manifest.json'), 'utf8'));

  assert.equal(
    sha256(inputBytes),
    '6e75a41633948ebeb3a8d25fb871d2ac23da0872c7709a2fb9035190fefb2215',
  );
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    candidate: { marketingVersion: '3.0', buildNumber: '9' },
    status: 'aborted-pre-provider-phase-gate-failure',
    frozenSource: {
      commit: '5e345b76fbc7b6090e882dffad2411961de67557',
      sha256: '085f5bfa362bedd7dc51017fc89f549292e231401e75de5e7ca2316c291ce3f6',
    },
    buildInputAuthority: {
      commit: '62a24157a66185f3de05350734d48da5cb4e2838',
      relativePath: 'build-input-attestation.json',
      sha256: sha256(inputBytes),
    },
    abortReason: 'post-pin-phase-stale-release-tests',
    providerOperationInitiated: false,
    easBuildId: null,
    ipaSha256: null,
    easSubmissionId: null,
    appleUploadStatus: null,
  });
  assert.equal(JSON.parse(inputBytes).candidate.buildNumber, '9');
});

test('build 11 is immutable EAS-finished attested history and was never uploaded', () => {
  const history = join(root, 'release/app-store/3.0/history/build-11');
  const inputBytes = readFileSync(join(history, 'build-input-attestation.json'));
  const artifactBytes = readFileSync(join(history, 'build-artifact-attestation.json'));
  const manifestBytes = readFileSync(join(history, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);

  assert.equal(sha256(inputBytes), 'ff59dcaa8082be48fa6bf36100d9f95126e2975336fbe054f9a4c120a5862551');
  assert.equal(sha256(artifactBytes), 'f563d773a66d086325117257141801731b743f289471232a606219413c2c6e1f');
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '11',
    },
    status: 'eas-finished-attested-not-uploaded-invalidated-by-post-pin-gate-failure',
    buildInputAttestation: {
      relativePath: 'build-input-attestation.json',
      sha256: sha256(inputBytes),
    },
    buildArtifactAttestation: {
      relativePath: 'build-artifact-attestation.json',
      sha256: sha256(artifactBytes),
    },
    frozenSource: {
      commit: '6410328f4d1f69527c7f52eaf19d650bed964895',
      sourceTreeSha256: '956a13476f8d20aa337aa5053b2c7db78b20d7ca79985f2355339de829855553',
    },
    authorityCommits: {
      inputPin: '63a676b5e984bbfb01399e249e816b3a3081c26d',
      artifactPin: '5a85c6d22a47fbe3a079d9cfafd631b28aa325ed',
    },
    easArtifactAssociation: {
      buildId: 'bb637983-9a37-49e3-aa0f-72e09169547e',
      ipaSha256: '66d3d4b7f00c54e6fe5ed2830efdf284cee0905d2d1e6f7ce3b2ff40991014bd',
    },
    easSubmission: null,
    appleObservation: null,
    invalidation: {
      recordedAt: '2026-09-04T15:26:49.000Z',
      gate: 'npm test',
      test: 'tests/build11-rebaseline-contract.test.mjs',
      reason: 'phase-stale synthetic fixture discovered only after the artifact pin',
      providerOperationInitiated: true,
      testFlightUploadInitiated: false,
    },
  });
  assert.equal(manifestBytes.toString('utf8'), `${JSON.stringify(manifest)}\n`);
  assert.equal(JSON.parse(inputBytes).candidate.buildNumber, '11');
  assert.equal(JSON.parse(artifactBytes).candidate.buildNumber, '11');
});

test('build 11 attempt 1 is exact invalidated pre-provider input authority history', () => {
  const history = join(root, 'release/app-store/3.0/history/build-11-input-attempt-1-aborted');
  const inputBytes = readFileSync(join(history, 'build-input-attestation.json'));
  const manifestBytes = readFileSync(join(history, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);

  assert.equal(sha256(inputBytes), 'e0b888bada5ce1f0d39b408307f3a107562a7007f891bd541d08bb2b4528b4fd');
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-authority-history',
    attempt: 1,
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '11',
    },
    status: 'input-attested-invalidated-pre-provider-source-drift',
    frozenSource: {
      commit: '3f61e31c3276870b4825b73e038903afdd9ef400',
      sha256: 'a2f3270ddea31b8a8ce7b55b021a6ba68244579e7e368e68834b19458da7b56d',
    },
    buildInputAuthority: {
      commit: '7350fe3df896c8f6391d6d691734df065414b146',
      relativePath: 'build-input-attestation.json',
      sha256: sha256(inputBytes),
    },
    invalidation: {
      commit: 'aac7e5fdc4eb234e3eb7d02ae8c7f2d0da1c398b',
      changedPaths: ['tests/build11-rebaseline-contract.test.mjs'],
    },
    providerOperationInitiated: false,
    easBuildId: null,
    ipaSha256: null,
    easSubmissionId: null,
    appleUploadStatus: null,
  });
  assert.equal(manifestBytes.toString('utf8'), `${JSON.stringify(manifest)}\n`);
});

test('build 11 attempt 2 is exact invalidated pre-provider input authority history', () => {
  const history = join(root, 'release/app-store/3.0/history/build-11-input-attempt-2-aborted');
  const inputBytes = readFileSync(join(history, 'build-input-attestation.json'));
  const manifestBytes = readFileSync(join(history, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);

  assert.equal(sha256(inputBytes), 'f8db7a38cab23030329102d3a2093d01afa416043fd27ce1266ae1b0a9fe15cc');
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-build-input-authority-history',
    attempt: 2,
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '11',
    },
    status: 'input-attested-invalidated-pre-provider-post-pin-gate-failure',
    frozenSource: {
      commit: '96db06242c418c49b99094bed5eef778d9e63e53',
      sha256: 'c150b516891a83795b22247b98f16ef54427165811ad7baf2c96893919a24842',
    },
    buildInputAuthority: {
      commit: '279c49bfc5d5f4c9d45b3953a93f1bf86453d718',
      relativePath: 'build-input-attestation.json',
      sha256: sha256(inputBytes),
    },
    invalidation: {
      commit: '71c0a98a36e7ce86aab016cc4be05f0e29e708f7',
      changedPaths: [
        'tests/build11-rebaseline-contract.test.mjs',
        'tests/release-command-guard.test.mjs',
      ],
    },
    providerOperationInitiated: false,
    easBuildId: null,
    ipaSha256: null,
    easSubmissionId: null,
    appleUploadStatus: null,
  });
  assert.equal(manifestBytes.toString('utf8'), `${JSON.stringify(manifest)}\n`);
});

test('every build-8 reference in the current-document allowlist is classified as history', () => {
  let classifiedReferenceCount = 0;
  for (const relativePath of CURRENT_DOCUMENT_REVIEW_ALLOWLIST) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const references = [...source.matchAll(BUILD_8_REFERENCE)];
    if (relativePath === 'release/app-store/3.0/release-manifest.json') {
      assert.equal(references.length, 3, 'release manifest build-8 references drifted');
      const manifest = JSON.parse(source);
      assert.equal(manifest.candidate.buildNumber, '12');
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

test('every build-9 reference in current documents is classified as aborted history', () => {
  let classifiedReferenceCount = 0;
  for (const relativePath of CURRENT_DOCUMENT_REVIEW_ALLOWLIST) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const references = [...source.matchAll(BUILD_9_REFERENCE)];
    if (relativePath === 'release/app-store/3.0/release-manifest.json') {
      const manifest = JSON.parse(source);
      const historical = manifest.historicalCandidateEvidence.filter(
        ({ marketingVersion, buildNumber }) => marketingVersion === '3.0' && buildNumber === '9',
      );
      assert.deepEqual(historical, [{
        marketingVersion: '3.0',
        buildNumber: '9',
        status: 'input-attested-aborted-pre-provider',
        appStoreObserved: false,
        trackedHistoryRoot: 'release/app-store/3.0/history/build-9-aborted',
        privateHistoryRoot: null,
      }]);
      classifiedReferenceCount += references.length + 1;
      continue;
    }
    if (relativePath.endsWith('.json')) {
      assert.equal(references.length, 0, `${relativePath} must not contain stale build-9 authority`);
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
        HISTORICAL_BUILD_9_CONTEXT,
        `${relativePath}: ${reference[0]} lacks aborted-history classification`,
      );
      for (const stalePattern of STALE_BUILD_9_AUTHORITY) {
        assert.doesNotMatch(
          paragraph,
          stalePattern,
          `${relativePath}: ${reference[0]} is stale current/future authority`,
        );
      }
      classifiedReferenceCount += 1;
    }
  }
  assert.ok(classifiedReferenceCount > 0, 'allowlist must retain classified build-9 history');
});

test('build 10 references in current authority are processed immutable history, never pending work', () => {
  let classifiedReferenceCount = 0;
  for (const relativePath of CURRENT_DOCUMENT_REVIEW_ALLOWLIST) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const references = [...source.matchAll(BUILD_10_REFERENCE)];
    if (relativePath === 'release/app-store/3.0/release-manifest.json') {
      const manifest = JSON.parse(source);
      const historical = manifest.historicalCandidateEvidence.filter(
        ({ marketingVersion, buildNumber }) => marketingVersion === '3.0' && buildNumber === '10',
      );
      assert.deepEqual(historical, [{
        marketingVersion: '3.0',
        buildNumber: '10',
        status: 'processed-internal-testflight-history',
        appStoreObserved: true,
        trackedHistoryRoot: 'release/app-store/3.0/history/build-10',
        privateHistoryRoot: 'release/private/rc-build-10',
      }]);
      classifiedReferenceCount += references.length + 1;
      continue;
    }
    if (relativePath.endsWith('.json')) {
      assert.equal(references.length, 0, `${relativePath} must not contain build-10 operational authority`);
      continue;
    }
    classifiedReferenceCount += assertBuild10ProseIsHistorical(relativePath, source);
  }
  assert.ok(classifiedReferenceCount > 0, 'allowlist must retain classified build-10 history');
});

test('build-10 clause-local classification rejects each stale pre-fix operational passage', () => {
  const mutations = [
    {
      relativePath: 'docs/operations/dynamic-miniapp-catalog.md',
      current: 'Build 10 was built,\nattested, uploaded, and processed for internal TestFlight; it is immutable\nhistory.',
      stale: 'Build 10,\nphysical-device QA, and current release evidence remain pending.',
    },
    {
      relativePath: 'docs/operations/dynamic-miniapp-production-activation-2026-08-25.md',
      current: 'Build 10 was built, attested, uploaded, and processed for internal\nTestFlight.',
      stale: 'Build 10 input freeze, EAS build, exact IPA audit, and TestFlight\nprocessing remain pending.',
    },
    {
      relativePath: 'docs/operations/vip-showcase-production-activation-2026-08-26.md',
      current: 'Build 10 was\n  built, attested, uploaded, and processed for internal TestFlight; it is\n  immutable history.',
      stale: 'Build 10\n  carries that behavior plus the WebView subframe fix; neither hands an internal\n  launch to Chrome, Safari, or another external browser.',
    },
  ];
  for (const { relativePath, current, stale } of mutations) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const mutated = source.replace(current, stale);
    assert.notEqual(mutated, source, `${relativePath}: fixture must target current authority`);
    assert.throws(
      () => assertBuild10ProseIsHistorical(relativePath, mutated),
      /lacks processed-history classification in its local clause/u,
    );
  }
});

test('build-10 clause-local classification covers lower-case, hyphen, and slash prose forms', () => {
  const historical = [
    'build 10 was built, attested, uploaded, and processed for internal TestFlight.',
    'build-10 is immutable processed internal-TestFlight history.',
    '3.0/build 10 is processed internal-TestFlight history and cannot authorize build 12.',
  ].join('\n\n');
  assert.equal(assertBuild10ProseIsHistorical('fixture.md', historical), 3);

  for (const stale of [
    'build 10 remains the current candidate.',
    'build-10 remains the current candidate.',
    '3.0/build 10 remains pending.',
  ]) {
    assert.throws(
      () => assertBuild10ProseIsHistorical('fixture.md', stale),
      /local clause/u,
    );
  }
});

test('build 11 references in current authority are immutable non-uploaded history, never the current candidate', () => {
  let classifiedReferenceCount = 0;
  for (const relativePath of CURRENT_DOCUMENT_REVIEW_ALLOWLIST) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    if (relativePath === 'release/app-store/3.0/release-manifest.json') {
      const manifest = JSON.parse(source);
      const historical = manifest.historicalCandidateEvidence.filter(
        ({ marketingVersion, buildNumber }) => marketingVersion === '3.0' && buildNumber === '11',
      );
      assert.deepEqual(historical, [{
        marketingVersion: '3.0',
        buildNumber: '11',
        status: 'eas-finished-attested-not-uploaded-invalidated-by-post-pin-gate-failure',
        appStoreObserved: false,
        trackedHistoryRoot: 'release/app-store/3.0/history/build-11',
        privateHistoryRoot: 'release/private/rc-build-11',
      }]);
      classifiedReferenceCount += 1;
      continue;
    }
    if (relativePath.endsWith('.json')) {
      assert.equal(
        [...source.matchAll(BUILD_11_PROSE_REFERENCE)].length,
        0,
        `${relativePath} must not contain build-11 operational authority`,
      );
      continue;
    }
    classifiedReferenceCount += assertBuild11ProseIsHistorical(relativePath, source);
  }
  assert.ok(classifiedReferenceCount > 0, 'allowlist must retain classified build-11 history');
});

test('build-11 clause-local classification rejects the stale current-candidate wording', () => {
  for (const stale of [
    'CaboHealth 3.0/build 11 is the current candidate.',
    'Build-11 freeze requirements.',
    'The current release candidate is build 11.',
  ]) {
    assert.throws(
      () => assertBuild11ProseIsHistorical('fixture.md', stale),
      /local clause/u,
    );
  }
});

test('current build-12 evidence writers retain only their exact task-scoped SDD parents', () => {
  const expectedParents = new Map([
    ['scripts/release-eas-environment-sanitizer.mjs', `${BUILD_12_SDD_ROOT}/task-2-evidence`],
    ['scripts/create-build-input-attestation.mjs', `${BUILD_12_SDD_ROOT}/task-2-evidence`],
    ['scripts/release-eas-artifact-downloader.mjs', `${BUILD_12_SDD_ROOT}/task-4-evidence`],
    ['scripts/create-build-artifact-attestation.mjs', `${BUILD_12_SDD_ROOT}/task-4-evidence`],
    ['scripts/release-eas-submission-sanitizer.mjs', `${BUILD_12_SDD_ROOT}/task-5-evidence`],
  ]);
  for (const [relativePath, parent] of expectedParents) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.match(source, new RegExp(`const TASK_PARENT = '${parent}';`, 'u'));
    assert.doesNotMatch(source, /2026-08-31-cabohealth-build10-testflight-release\/task-[0-9]-evidence/u);
  }
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
