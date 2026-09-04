import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const verifierPath = join(projectRoot, 'scripts/verify-app-store-metadata.mjs');
const releasePath = 'release/app-store/3.0';
const authorityPaths = Object.freeze([
  'app.json',
  'eas.json',
  'app-review-private/content/sample.json',
  'assets/adaptive-icon.png',
  'assets/favicon.png',
  'assets/icon.png',
  'assets/logo-white.png',
  'assets/logo-wordmark.png',
  'assets/logo.png',
  'assets/splash-icon.png',
  'assets/splash.png',
  'client-resources-private/content/en.json',
  'client-resources-private/content/es-MX.json',
  'constants/config.ts',
  'constants/publicMiniapps.ts',
  'content/clinic-guide.json',
  'content/recipes.json',
  'features/onboarding/IntroScreen.tsx',
  'features/resources/CitationList.tsx',
  'features/resources/RecipeBrowser.tsx',
  'features/resources/VisitChecklist.tsx',
  'features/resources/publicContent.ts',
  'i18n/messages.ts',
  'miniapps/clinic-guide/index.html',
  'miniapps/healthy-recipes/index.html',
  'miniapps/shared/clinic-map-texture.png',
  'miniapps/shared/logo-wordmark.png',
  'miniapps/shared/logo.png',
  'release/compliance-facts.json',
  'release/content-rights.md',
  'release/data-inventory.md',
  'release/public-contact-facts.json',
  'staff-portal/public/favicon.svg',
  'staff-portal/src/i18n/messages.ts',
  'web-hosting/cabohealth.org/app/index.html',
  'web-hosting/cabohealth.org/app/privacy/index.html',
  'web-hosting/cabohealth.org/app/report-content/index.html',
  'web-hosting/cabohealth.org/app/support/index.html',
  'web-hosting/cabohealth.org/app/terms/index.html',
]);

const screenshotLocales = Object.freeze(['en-US', 'es-MX']);
const screenshotSceneIds = Object.freeze([
  '01-launch',
  '02-resource-catalog',
  '03-healthy-recipes',
  '04-clinic-guide',
  '05-client-resources-locked',
  '06-eligibility-code-entry',
  '07-saved',
  '08-settings-and-legal',
]);

function screenshotPng(width, height, suffix) {
  const bytes = Buffer.alloc(24 + Buffer.byteLength(suffix));
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write(suffix, 24, 'utf8');
  return bytes;
}

function writeFinalScreenshotAuthority(root) {
  const testFlightBuildId = '987654321';
  const sourceTreeSha256 = 'a'.repeat(64);
  const captures = [];
  for (const locale of screenshotLocales) {
    for (const sceneId of screenshotSceneIds) {
      const relativePath = `screenshots/${locale}/iphone-6.9/${sceneId}.png`;
      const absolutePath = join(root, 'release/private/rc-build-11', relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
      const bytes = screenshotPng(1320, 2868, `${locale}:${sceneId}`);
      writeFileSync(absolutePath, bytes, { mode: 0o600 });
      chmodSync(absolutePath, 0o600);
      captures.push({
        locale,
        sceneId,
        relativePath,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: 1320,
        height: 2868,
        format: 'png',
        capturedAt: '2026-08-25T17:00:00.000Z',
        testFlightBuildId,
      });
    }
  }
  const manifest = {
    schemaVersion: 2,
    status: 'exact-rc-captured-and-approved',
    marketingVersion: '3.0',
    buildNumber: '11',
    deviceClass: 'iPhone 6.9-inch',
    locales: [...screenshotLocales],
    sceneIds: [...screenshotSceneIds],
    captures,
    requiredEvidence: {
      testFlightBuildId,
      sourceSha: sourceTreeSha256,
      imageHashes: captures.map((capture) => capture.sha256),
      ocrExcludedScopeCheck: true,
      humanVisualSignOff: true,
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(join(root, releasePath, 'screenshots-manifest.json'), manifestBytes);
  writeFileSync(join(root, releasePath, 'rc-attestation.json'), `${JSON.stringify({
    schemaVersion: 1,
    artifactKind: 'cabohealth-ios-exact-rc-attestation',
    candidate: {
      appleId: '6758285327',
      bundleIdentifier: 'com.cabohealth.app',
      marketingVersion: '3.0',
      buildNumber: '11',
    },
    buildArtifactAttestationSha256: 'b'.repeat(64),
    sourceTreeSha256,
    testFlightBuildId,
    testFlightProcessedAt: '2026-08-25T16:00:00.000Z',
    physicalIphoneQaSha256: 'c'.repeat(64),
    screenshotsManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    appStoreMetadataEvidenceSha256: 'd'.repeat(64),
    reviewedAt: '2026-08-25T18:00:00.000Z',
  })}\n`);
  return captures;
}

function verify(root) {
  return spawnSync(process.execPath, [verifierPath, root], {
    cwd: root,
    encoding: 'utf8',
  });
}

function mutateJson(root, relativePath, mutate) {
  const absolutePath = join(root, relativePath);
  const value = JSON.parse(readFileSync(absolutePath, 'utf8'));
  mutate(value);
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function recordOwnerConfirmations() {
  // The canonical v3 fixture already contains the five verified owner facts.
}

function addOwnerSellerDraft() {
  // The canonical v3 fixture already contains the exact owner/seller draft.
}

function withReleaseFixture(mutate, assertion) {
  const root = mkdtempSync(join(tmpdir(), 'cabohealth-app-store-metadata-'));
  try {
    cpSync(join(projectRoot, releasePath), join(root, releasePath), { recursive: true });
    for (const relativePath of authorityPaths) {
      const destination = join(root, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(projectRoot, relativePath), destination);
    }
    mutate(root);
    assertion(verify(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('versioned App Store metadata has a valid phase-neutral 3.0 build 11 authority contract', () => {
  const result = verify(projectRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /metadata authority verified; submission remains blocked/i);
});

test('metadata verifier rejects malformed build-11 input-attempt authority history', async (t) => {
  await t.test('archive drift', () => withReleaseFixture(
    (root) => mutateJson(
      root,
      `${releasePath}/history/build-11-input-attempt-1-aborted/manifest.json`,
      (manifest) => { manifest.invalidation.changedPaths = []; },
    ),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /invalidated input authority history must retain the exact canonical archive/i);
    },
  ));
});

test('metadata verifier rejects stale or contradictory live ASC evidence', async (t) => {
  const mutations = [
    ['missing observation time', (manifest) => { delete manifest.ascEvidence.observedAt; }],
    ['build list is not an array', (manifest) => { manifest.ascEvidence.testFlightBuilds = {}; }],
    ['version not editable', (manifest) => { manifest.ascEvidence.versionEditable = false; }],
    ['wrong rejected status', (manifest) => { manifest.ascEvidence.currentRejectedVersionStatus = 'ready-for-sale'; }],
    ['wrong selected binary version', (manifest) => { manifest.ascEvidence.selectedRejectedBinaryVersion = '2.0.0'; }],
    ['historical build not expired', (manifest) => { manifest.ascEvidence.testFlightBuilds[1].status = 'ready-to-test'; }],
    ['wrong selected build', (manifest) => { manifest.ascEvidence.selectedRejectedBuild = '4'; }],
    ['processed build 7 status drift', (manifest) => {
      manifest.ascEvidence.testFlightBuilds.at(-1).status = 'expired';
    }],
    ['wrong highest build', (manifest) => { manifest.ascEvidence.highestTestFlightBuild = '5'; }],
    ['wrong next build', (manifest) => { manifest.ascEvidence.nextCandidateBuild = '6'; }],
    ['historical build 8 availability drift', (manifest) => { manifest.ascEvidence.nextCandidateBuildAvailable = false; }],
    ['wrong rejection date', (manifest) => { manifest.ascEvidence.latestReviewDate = '2026-02-23'; }],
    ['missing rejection guideline', (manifest) => { manifest.ascEvidence.latestReviewGuidelines = ['2.1', '4.1']; }],
    ['information request omitted', (manifest) => { manifest.ascEvidence.informationRequested = false; }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/release-manifest.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed ASC evidence validation`);
        assert.doesNotMatch(result.stderr, /TypeError|RELEASE_METADATA_INTERNAL_ERROR/u);
        assert.match(result.stderr, /(?:ASC read-only evidence must retain the exact sanitized authority schema|dated ASC read-only evidence must retain its exact build-8-era snapshot)/i);
      },
    ));
  }
});

test('metadata verifier keeps the candidate identity and phase-source schema exact', async (t) => {
  const mutations = [
    ['phase rollback', (candidate) => { candidate.status = 'draft-blocked'; }],
    ['app config rollback', (candidate) => { candidate.appJsonUpdated = false; }],
    ['visible config rollback', (candidate) => { candidate.configUpdated = false; }],
    ['wrong live phase source', (candidate) => { candidate.liveAuthorityPhaseSource = 'manifest-static-status'; }],
    ['missing live phase source', (candidate) => { delete candidate.liveAuthorityPhaseSource; }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => mutate(manifest.candidate)),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed candidate phase validation`);
        assert.match(result.stderr, /phase-neutral 3\.0 build 11 candidate configuration/i);
      },
    ));
  }
});

test('metadata verifier rejects empty required release and authoritative artifacts', async (t) => {
  for (const relativePath of [
    `${releasePath}/review-notes.md`,
    `${releasePath}/en-US.md`,
    `${releasePath}/screenshots-manifest.json`,
    `${releasePath}/content-rights-inventory.md`,
    'release/compliance-facts.json',
    'release/public-contact-facts.json',
  ]) {
    await t.test(relativePath, () => withReleaseFixture(
      (root) => writeFileSync(join(root, relativePath), ''),
      (result) => {
        assert.equal(result.status, 1, `${relativePath} empty artifact bypassed verifier`);
        assert.match(result.stderr, /must not be empty/iu);
      },
    ));
  }
});

test('metadata verifier binds the exact content-rights inventory to every listed source hash', async (t) => {
  await t.test('inventory candidate build drift', () => withReleaseFixture(
    (root) => writeFileSync(
      join(root, releasePath, 'content-rights-inventory.md'),
      readFileSync(join(root, releasePath, 'content-rights-inventory.md'), 'utf8')
        .replace('build `11`', 'build `10`'),
    ),
    (result) => {
      assert.equal(result.status, 1, 'stale content-rights candidate build bypassed verifier');
      assert.match(
        result.stderr,
        /Content-rights inventory must target Apple ID 6758285327, bundle com\.cabohealth\.app, version 3\.0, and build 11/iu,
      );
    },
  ));

  await t.test('inventory prose drift', () => withReleaseFixture(
    (root) => writeFileSync(
      join(root, releasePath, 'content-rights-inventory.md'),
      readFileSync(join(root, releasePath, 'content-rights-inventory.md'), 'utf8')
        .replace('PER-FAMILY BASIS', 'UNREVIEWED BASIS'),
    ),
    (result) => {
      assert.equal(result.status, 1, 'content-rights inventory drift bypassed verifier');
      assert.match(result.stderr, /content-rights-inventory\.md.*exact reviewed prose/iu);
    },
  ));

  await t.test('inventory exact RC regressed to build 6', () => withReleaseFixture(
    (root) => {
      const path = join(root, releasePath, 'content-rights-inventory.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        'exact 3.0 (11) RC',
        'exact 3.0 (6) RC',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, 'stale exact build-6 RC bypassed verifier');
      assert.match(result.stderr, /exact RC must be build 11/iu);
    },
  ));

  await t.test('declared-identical asset drift', () => withReleaseFixture(
    (root) => writeFileSync(join(root, 'miniapps/shared/logo.png'), 'drift'),
    (result) => {
      assert.equal(result.status, 1, 'content-rights source drift bypassed verifier');
      assert.match(result.stderr, /Content-rights source SHA-256 mismatch: miniapps\/shared\/logo\.png/iu);
    },
  ));

  await t.test('reviewed public catalog source drift', () => withReleaseFixture(
    (root) => {
      const path = join(root, 'constants/publicMiniapps.ts');
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n// unreviewed catalog drift\n`);
    },
    (result) => {
      assert.equal(result.status, 1, 'reviewed public catalog source drift bypassed verifier');
      assert.match(result.stderr, /Content-rights source SHA-256 mismatch: constants\/publicMiniapps\.ts/iu);
    },
  ));

  await t.test('reviewed Staff catalog copy drift', () => withReleaseFixture(
    (root) => {
      const path = join(root, 'staff-portal/src/i18n/messages.ts');
      const source = readFileSync(path, 'utf8');
      const mutated = source.replace('Live catalog', 'Unreviewed catalog');
      assert.notEqual(mutated, source, 'Staff catalog copy fixture must contain its reviewed label');
      writeFileSync(path, mutated);
    },
    (result) => {
      assert.equal(result.status, 1, 'reviewed Staff catalog copy drift bypassed verifier');
      assert.match(result.stderr, /Content-rights source SHA-256 mismatch: staff-portal\/src\/i18n\/messages\.ts/iu);
    },
  ));

  await t.test('listed source empty', () => withReleaseFixture(
    (root) => writeFileSync(join(root, 'miniapps/shared/logo.png'), ''),
    (result) => {
      assert.equal(result.status, 1, 'empty content-rights source bypassed verifier');
      assert.match(result.stderr, /Content-rights source must not be empty: miniapps\/shared\/logo\.png/iu);
    },
  ));

  await t.test('listed source symlink', () => withReleaseFixture(
    (root) => {
      rmSync(join(root, 'staff-portal/public/favicon.svg'));
      symlinkSync(join(root, 'assets/favicon.png'), join(root, 'staff-portal/public/favicon.svg'));
    },
    (result) => {
      assert.equal(result.status, 1, 'content-rights source symlink bypassed verifier');
      assert.match(result.stderr, /Content-rights source must be a regular non-symbolic-link file/iu);
    },
  ));
});

test('metadata verifier rejects null JSON authorities instead of skipping them', async (t) => {
  for (const relativePath of [
    `${releasePath}/release-manifest.json`,
    `${releasePath}/age-rating.json`,
    `${releasePath}/app-privacy.json`,
  ]) {
    await t.test(relativePath, () => withReleaseFixture(
      (root) => writeFileSync(join(root, relativePath), 'null\n'),
      (result) => {
        assert.equal(result.status, 1, `${relativePath} null authority bypassed verifier`);
        assert.match(result.stderr, /must be a JSON object/iu);
      },
    ));
  }
});

test('Review Notes retain the prior-review resolution, current privacy facts, and manual-entry behavior', () => {
  const notes = readFileSync(join(projectRoot, releasePath, 'review-notes.md'), 'utf8');
  const pasteReadyBody = notes.split('## Paste-ready body after all gates are resolved')[1]?.trim() ?? '';

  assert.ok([...pasteReadyBody].length <= 4000, 'paste-ready Review Notes must fit Apple’s 4,000-character limit');
  assert.match(pasteReadyBody, /two public wellness\/editorial resources plus protected Client Resources/i);
  assert.match(
    pasteReadyBody,
    /GUIDELINE 4\.7 — HOSTED RESOURCES\n1\. Healthy Recipes — public — https:\/\/cabohealth\.org\/apps\/healthy-recipes\/\n2\. CaboHealth Clinic Guide — public — https:\/\/cabohealth\.org\/apps\/clinic-guide\/\n3\. Client Resources — protected existing-client eligibility — https:\/\/cabohealth\.org\/apps\/client-resources\/\n\nAt the time of submission, only these Universal Links enter\./u,
  );
  assert.doesNotMatch(notes, /\[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS/i);
  assert.doesNotMatch(notes, /continues automatically|about 1\.6 seconds/i);
  assert.doesNotMatch(notes, /\bOn Apps\b|\bReturn to Apps\b/i);
  assert.match(notes, /PRIOR REVIEW RESOLUTION/i);
  assert.match(notes, /Former advisory and camera-based AI resources are excluded/i);
  assert.match(notes, /No third-party AI is implemented\/invoked; app code sends no data to an AI provider/i);
  assert.match(notes, /No camera, Photos, HealthKit, microphone, or location access; WebViews deny media\/geolocation/i);
  assert.match(notes, /Both public resources show dated Sources\/Fuentes with official links/i);
  assert.match(notes, /remains on the introduction until the reviewer taps “Enter CaboHealth”/i);
  assert.match(notes, /On Home, confirm two public resources and locked Client Resources/i);
  assert.match(notes, /Hostinger verification observed IP, timestamp, method, resource, device\/user-agent, country, bytes, and latency/i);
  assert.match(notes, /Authorized logs include IP, user-agent, URL, and errors for delivery\/security\/troubleshooting/i);
  assert.match(notes, /hPanel shows up to 7 days/i);
  assert.match(notes, /added retention\/deletion is Hostinger-controlled/i);
  assert.match(notes, /Launch nonces and hosted sessions are short-lived/i);
  assert.match(notes, /Home > Client Resources > “Delete review access and data”/i);
  assert.match(notes, /Confirm pending\/completed; if pending, reopen it without signing in for completion confirmation/i);
  assert.match(notes, /Durable deletion revokes access on acceptance; expiry\/admin revocation queues cleanup/i);
  assert.match(notes, /random 256-bit receipt stays in SecureStore/i);
  assert.match(notes, /server keeps only a keyed-HMAC lookup and status timestamps/i);
  assert.match(notes, /expects completion within 30 days/i);
  assert.match(notes, /confirms after reopening/i);
  assert.match(notes, /Staff-audit deletion deadline is 30 days; Firestore TTL is asynchronous/i);
  assert.match(notes, /Cloud Functions writes no raw IP to Firestore; only keyed-HMAC rate-limit buckets with a 30-minute deadline/i);
  assert.match(notes, /Google Cloud Logging retains automatic Cloud Run request logs—source IP, method\/URL, user-agent, status, latency, sizes, protocol—for 30 days in `_Default`; no exclusion/i);
  assert.match(notes, /No health information or sensitive device permission is requested/i);
  assert.match(notes, /Owner-added Public or VIP resources may display third-party HTTPS websites inside CaboHealth/i);
  assert.match(notes, /same-origin navigation is constrained/i);
  assert.match(notes, /VIP access controls only the in-app entry point/i);
  assert.match(notes, /third-party content is not made private or authored by CaboHealth/i);
  assert.match(notes, /rights verification is required before activation/i);
  assert.match(notes, /destination host independently receives normal network data/i);
  assert.doesNotMatch(notes, /eightsleep\.com/i);
});

test('metadata verifier rejects Review Notes regressions in hosting facts or entry behavior', async (t) => {
  const mutations = [
    [
      'hosting placeholder restored',
      (source) => source.replace(
        /Hostinger verification observed[\s\S]*?no tracking\./u,
        '[INSERT VERIFIED HOSTINGER REQUEST-LOG FIELDS, PURPOSE, RETENTION, DELETION, AND FINAL APP PRIVACY MAPPING.]',
      ),
      /obsolete hosting blocker placeholder/i,
    ],
    [
      'observed log fields omitted',
      (source) => source.replace(
        /Hostinger verification observed IP, timestamp, method, resource, device\/user-agent, country, bytes, and latency\. /u,
        '',
      ),
      /missing observed Hostinger log fields/i,
    ],
    [
      'log fields generalized',
      (source) => source.replace(
        'Authorized logs include IP, user-agent, URL, and errors',
        'ordinary request data',
      ),
      /missing owner-authorized Hostinger log fields/i,
    ],
    [
      'hosting purpose omitted',
      (source) => source.replace('for delivery/security/troubleshooting', 'for operations'),
      /missing Hostinger log purpose/i,
    ],
    [
      'hPanel duration changed',
      (source) => source.replace('hPanel shows up to 7 days', 'hPanel shows for 30 days'),
      /missing owner-authorized hPanel visibility/i,
    ],
    [
      'Hostinger deletion control generalized',
      (source) => source.replace('added retention/deletion is Hostinger-controlled', 'retention is handled'),
      /missing owner-authorized retention\/deletion disclosure/i,
    ],
    [
      'prior-review heading omitted',
      (source) => source.replace('PRIOR REVIEW RESOLUTION', 'REVIEW HISTORY'),
      /missing prior-review resolution/i,
    ],
    [
      'former advisory and camera-AI removal omitted',
      (source) => source.replace('Former advisory and camera-based AI resources are excluded.', 'Former resources changed.'),
      /missing prior advisory\/camera-AI removal/i,
    ],
    [
      'third-party AI boundary omitted',
      (source) => source.replace(
        'No third-party AI is implemented/invoked; app code sends no data to an AI provider.',
        'AI behavior is limited.',
      ),
      /missing no-third-party-AI and no-AI-data disclosure/i,
    ],
    [
      'sensitive permissions exclusion omitted',
      (source) => source.replace(
        'No camera, Photos, HealthKit, microphone, or location access; WebViews deny media/geolocation.',
        'Permissions are limited.',
      ),
      /missing exact sensitive-permission exclusion/i,
    ],
    [
      'official editorial sources omitted',
      (source) => source.replace(
        'Both public resources show dated Sources/Fuentes with official links.',
        'Public resources include content.',
      ),
      /missing official editorial-source disclosure/i,
    ],
    [
      'automatic entry restored',
      (source) => source.replace(
        'The app remains on the introduction until the reviewer taps “Enter CaboHealth”.',
        'The app continues automatically after about 1.6 seconds.',
      ),
      /obsolete automatic introduction timing/i,
    ],
    [
      'launch and hosted-session lifecycle generalized',
      (source) => source.replace('Launch nonces and hosted sessions are short-lived.', 'Grants are short-lived.'),
      /missing short-lived launch and hosted-session disclosure/i,
    ],
    [
      'deletion lifecycle generalized',
      (source) => source.replace(
        'Durable deletion revokes access on acceptance; expiry/admin revocation queues cleanup.',
        'Account removal is available.',
      ),
      /missing exact deletion lifecycle disclosure/i,
    ],
    [
      'review deletion path omitted',
      (source) => source.replace('Home > Client Resources > “Delete review access and data”', 'Settings > Delete'),
      /missing exact App Review deletion path/i,
    ],
    [
      'deletion status review step omitted',
      (source) => source.replace('Confirm pending/completed; if pending, reopen it without signing in for completion confirmation.', 'Close the app.'),
      /missing deletion status and completion-confirmation review step/i,
    ],
    [
      'deletion receipt downgraded',
      (source) => source.replace('A random 256-bit receipt stays in SecureStore', 'A deletion marker is stored locally'),
      /missing durable deletion receipt disclosure/i,
    ],
    [
      'deletion receipt server boundary omitted',
      (source) => source.replace('the server keeps only a keyed-HMAC lookup and status timestamps', 'the server stores the receipt'),
      /missing deletion receipt server-boundary disclosure/i,
    ],
    [
      'deletion completion window guaranteed',
      (source) => source.replace('expects completion within 30 days', 'guarantees completion within 30 days'),
      /missing non-guaranteed expected deletion window/i,
    ],
    [
      'deletion completion confirmation omitted',
      (source) => source.replace('confirms after reopening', 'does not show completion'),
      /missing in-app deletion completion confirmation/i,
    ],
    [
      'audit deadline made synchronous',
      (source) => source.replace(
        'Staff-audit deletion deadline is 30 days; Firestore TTL is asynchronous.',
        'Staff audits are retained for 30 days.',
      ),
      /missing asynchronous audit-deletion disclosure/i,
    ],
    [
      'Cloud Functions Firestore source-IP boundary omitted',
      (source) => source.replace(
        'Cloud Functions writes no raw IP to Firestore; only keyed-HMAC rate-limit buckets with a 30-minute deadline.',
        'Cloud Functions handles technical traffic.',
      ),
      /missing Firestore source-IP rate-limit boundary/i,
    ],
    [
      'Cloud Run request-log fields omitted',
      (source) => source.replace(
        'source IP, method/URL, user-agent, status, latency, sizes, protocol',
        'technical request data',
      ),
      /missing automatic Cloud Run request-log retention disclosure/i,
    ],
    [
      'Cloud Run request-log retention changed',
      (source) => source.replace('for 30 days in `_Default`; no exclusion', 'for 7 days in `_Default`; no exclusion'),
      /missing automatic Cloud Run request-log retention disclosure/i,
    ],
    [
      'Cloud Run request-log exclusion invented',
      (source) => source.replace('in `_Default`; no exclusion', 'in `_Default`; exclusion configured'),
      /missing automatic Cloud Run request-log retention disclosure/i,
    ],
  ];

  for (const [name, mutate, expectedError] of mutations) {
    await t.test(name, () => {
      withReleaseFixture(
        (root) => {
          const path = join(root, releasePath, 'review-notes.md');
          const source = readFileSync(path, 'utf8');
          const mutated = mutate(source);
          assert.notEqual(mutated, source, `${name} fixture must mutate the current Review Notes`);
          writeFileSync(path, mutated);
        },
        (result) => {
          assert.equal(result.status, 1, result.stdout || result.stderr);
          assert.match(result.stderr, expectedError);
        },
      );
    });
  }
});

test('App Privacy preserves observed logs separately from the owner-authorized disclosure record', () => {
  const privacy = JSON.parse(readFileSync(join(projectRoot, releasePath, 'app-privacy.json'), 'utf8'));
  const compliance = JSON.parse(readFileSync(join(projectRoot, 'release/compliance-facts.json'), 'utf8'));

  assert.equal(privacy.schemaVersion, 6);
  assert.equal(privacy.backend.resourceUrlsReturnedToNative, true);
  assert.deepEqual(privacy.resourceUrlHandling, {
    publicV3CatalogRecordsContainExternalUrl: true,
    authorizedVipV2LaunchMayReturnExternalUrlTransiently: true,
    vipPreviewsContainExternalUrl: false,
    vipGrantsContainExternalUrl: false,
    nativeStorageContainsExternalUrl: false,
    applicationAuditContainsExternalUrl: false,
  });
  assert.deepEqual(privacy.thirdPartyNetworkRequests, {
    behavior: 'third-party-network-request',
    destinationHostReceivesNormalNetworkData: true,
    destinationOperatesIndependently: true,
    finalAppleMappingStatus: 'pending-final-destination-provider-and-category-review',
  });

  assert.deepEqual(
    privacy.hostedTechnicalRequestLogs.ownerAuthorizedFields,
    compliance.hosting.logTypes.value,
  );
  assert.deepEqual(privacy.hostedTechnicalRequestLogs.observedFields, [
    'IP address',
    'timestamp',
    'HTTP method',
    'requested resource',
    'device and user-agent details',
    'country',
    'response bytes',
    'latency',
  ]);
  assert.deepEqual(privacy.nativeBehavior.localOnlyState, [
    'saved public-resource slugs and order',
    'language, appearance, haptics, and effects preferences',
    'recipe favorite keys',
    'visit-checklist completion state',
  ]);
  assert.equal(privacy.schemaVersion, 6);
  assert.deepEqual(privacy.deletion, {
    durable: true,
    mechanism: 'transactional deletion tombstone plus idempotent retry worker',
    activeUserPath: 'Home > Client Resources > Delete access account and data',
    responseStatuses: ['pending', 'completed'],
    authorizationRevokedWhenAccepted: true,
    grantExpiryQueuesDeletion: true,
    administratorRevocationQueuesDeletion: true,
    retryWorkerMinutes: 5,
    completionTimeGuaranteed: false,
  });
  assert.deepEqual(privacy.deletionReceiptStatus, {
    receiptEntropyBits: 256,
    receiptEncoding: 'base64url',
    receiptEncodedLength: 43,
    nativeStorage: 'SecureStore',
    localStates: ['prepared', 'accepted'],
    preparedBeforeDeletionRequest: true,
    deleteRequestFields: ['installationId', 'deletionReceipt'],
    productionStatusCallable: 'getClientAccountDeletionStatus',
    reviewStatusCallable: 'getAppReviewAccountDeletionStatus',
    statusRequestFields: ['deletionReceipt'],
    statusResponse: {
      schemaVersion: 1,
      exactFields: [
        'schemaVersion',
        'status',
        'requestedAtMs',
        'expectedCompletionByMs',
        'completedAtMs',
      ],
      statuses: ['pending', 'completed'],
      pendingCompletedAtMs: null,
      timestampsAreIntegers: true,
    },
    limitedUseAppCheckRequired: true,
    firebaseAuthenticationRequired: false,
    rawReceiptStoredServerSide: false,
    serverLookupRepresentation: 'versioned keyed HMAC lookup only',
    productionCollection: '_private_account_deletion_receipts',
    reviewCollection: 'review_sandbox_account_deletion_receipts',
    separateRealmPeppers: true,
    statusRecordContainsUid: false,
    statusRecordContainsCode: false,
    statusRecordContainsResourceUrl: false,
    expectedCompletionDays: 30,
    expectedCompletionGuaranteed: false,
    retryWorkerMinutes: 5,
    pendingHasTtl: false,
    pendingRetention: 'until cleanup completes',
    completedRecordContainsOnlyStatusTimestamps: true,
    completedRetentionDays: 30,
    completedRetentionStartsAt: 'completedAtMs',
    completedPhysicalTtlDeletionAsynchronous: true,
    checksOnClientResourcesReopen: true,
    completionConfirmationInApp: true,
    localReceiptClearedAfterCompletedAcknowledgement: true,
    preparedNotFoundClearsReceipt: false,
    preparedNotFoundRestoresAccess: false,
    preparedNotFoundResubmitsSameReceipt: true,
    acceptedNotFoundRestoresAccess: false,
  });
  assert.deepEqual(privacy.reviewSandbox, {
    separateNamespace: true,
    multiDevice: true,
    fixedNonClientSample: true,
    productionClientRecordsExposed: false,
    userInitiatedDeletion: true,
    activeUserPath: 'Home > Client Resources > Delete review access and data',
    responseStatuses: ['pending', 'completed'],
    authorizationRevokedWhenAccepted: true,
    currentIdentityInactivityEligibilityDays: 30,
    staleGenerationEligibility: 'immediate',
    retryWorkerMinutes: 5,
    completionTimeGuaranteed: false,
    status: 'infrastructure-deployed-pending-credential-valid-flow-and-device-e2e',
  });
  assert.deepEqual(privacy.cloudFunctionRequestSecurity, {
    rawSourceIpProcessedTransiently: true,
    rawSourceIpStoredInFirestore: false,
    providerRequestLoggingDocumentedSeparately: true,
    storedRateLimitRepresentation: 'versioned keyed HMAC lookup only',
    purpose: ['rate limiting', 'abuse prevention'],
    rateLimitBucketDeletionDeadlineMinutes: 30,
    physicalTtlDeletionAsynchronous: true,
    tracking: false,
  });
  assert.deepEqual(privacy.cloudRunRequestLogs, {
    provider: 'Google Cloud Logging',
    automatic: true,
    observedFields: [
      'source IP address',
      'HTTP method',
      'requested URL',
      'user-agent',
      'HTTP status',
      'latency',
      'request and response sizes',
      'protocol',
    ],
    purpose: ['service delivery', 'security and troubleshooting'],
    retentionDays: 30,
    defaultSinkExclusionConfigured: false,
    deletionProcess: 'Google Cloud Logging applies the unlocked _Default bucket retention; expiration is provider-enforced and may be eventually consistent.',
    linkedToIdentity: null,
    tracking: false,
    verifiedDate: '2026-08-24',
  });
  assert.deepEqual(privacy.accessArtifacts, {
    redemptionRequestDigestDeadlineMinutes: 5,
    launchNonceDeadlineSeconds: 60,
    webSessionMaximumMinutes: 60,
    brokerReplayDigestDeadlineMinutes: 2,
    deletionTombstoneHasTtl: false,
    deletionTombstoneRetention: 'until linked-data and Firebase Auth cleanup completes',
    containsPlaintextSecrets: false,
  });
  assert.deepEqual(privacy.applicationAudit, {
    purpose: 'security and operational accountability',
    deletionDeadlineDays: 30,
    physicalTtlDeletionAsynchronous: true,
    actorLabel: 'Staff',
    containsActorUid: false,
    containsCodes: false,
    containsResourceUrls: false,
    containsClientNames: false,
  });
  assert.deepEqual(privacy.conditionalRecommendation.provisionalPurpose, [
    'App Functionality',
    'Analytics',
  ]);
  assert.deepEqual(privacy.conditionalRecommendation.provisionalCategoryMapping.slice(0, 2), [
    'User ID — linked to the user; App Functionality; not used for tracking (exact signed FirebaseAuth privacy manifest)',
    'Other Diagnostic Data — not linked to the user; Analytics; not used for tracking (exact signed FirebaseAuth privacy manifest)',
  ]);
});

test('metadata verifier accepts the five owner confirmations without releasing unverified gates', () => {
  withReleaseFixture(
    recordOwnerConfirmations,
    (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /metadata authority verified; submission remains blocked/i);
    },
  );
});

test('metadata verifier keeps the live-reconciled version configuration gate completed', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        '- [x] Rebaseline `app.json` and `constants/config.ts` together to 3.0/build 11 after preserving exact build-8 built/uploaded history, hash-binding build 9 as aborted before any provider operation, and preserving build 10 as immutable processed internal-TestFlight history; this completed configuration gate neither asserts nor negates a later live build-11 authority phase.',
        '- [ ] Rebaseline `app.json` and `constants/config.ts` together to 3.0/build 11 after preserving exact build-8 built/uploaded history, hash-binding build 9 as aborted before any provider operation, and preserving build 10 as immutable processed internal-TestFlight history; this completed configuration gate neither asserts nor negates a later live build-11 authority phase.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed pre-build version configuration checkbox/i);
    },
  );
});

test('metadata verifier keeps the build-5 build-input attestation gate completed', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        '- [x] Regenerate, freeze, and independently review the build-5 canonical build-input attestation;',
        '- [ ] Regenerate, freeze, and independently review the build-5 canonical build-input attestation;',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed build-5 build-input attestation checkbox/i);
    },
  );
});

test('metadata verifier keeps the build-6 build-input attestation gate completed', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        '- [x] Generate, independently review, and pin the build-6 canonical build-input attestation against the rebaselined 3.0/build 6 source and exact external mode-0600 production plist before its EAS build; do not reuse either obsolete build-5 attestation.',
        '- [ ] Generate, independently review, and pin the build-6 canonical build-input attestation against the rebaselined 3.0/build 6 source and exact external mode-0600 production plist before its EAS build; do not reuse either obsolete build-5 attestation.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed build-6 build-input attestation checkbox/i);
    },
  );
});

test('metadata verifier keeps the phase-neutral build-11 authority sequence completed', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        '- [x] Establish the fail-closed build-11 authority sequence: replacement canonical build-input attestation, build artifact, RC, and submit tool. Exact current pins and required attestation bytes determine the live phase; each phase must bind its reviewed predecessor, and no obsolete build-8, aborted build-9, immutable processed build-10, or invalidated build-11 attempt-1 authority may be reused.',
        '- [ ] Establish the fail-closed build-11 authority sequence: replacement canonical build-input attestation, build artifact, RC, and submit tool. Exact current pins and required attestation bytes determine the live phase; each phase must bind its reviewed predecessor, and no obsolete build-8, aborted build-9, immutable processed build-10, or invalidated build-11 attempt-1 authority may be reused.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed phase-neutral build-11 authority-sequence checkbox/i);
    },
  );
});

test('metadata verifier keeps the Staff Portal outside the consumer binary', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /Confirm the owner-only Staff Portal is not linked or reachable from the consumer binary\.\n/u,
        'The production owner portal is linked for every reviewer.\n',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Staff Portal consumer-exclusion disclosure/iu);
    },
  );
});

test('metadata verifier rejects regression of an owner-confirmed fact to pending', async (t) => {
  const mutations = [
    ['medical-device declaration', (root) => mutateJson(root, 'release/compliance-facts.json', (facts) => {
      facts.medicalDevice = { value: null, status: 'pending' };
    })],
    ['support SLA', (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
      manifest.gates.supportResponseSla = 'pending-owner';
    })],
    ['hosting retention disclosure', (root) => mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
      privacy.hostedTechnicalRequestLogs.retention = null;
    })],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => {
        recordOwnerConfirmations(root);
        mutate(root);
      },
      (result) => {
        assert.equal(result.status, 1, `${name} regression bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /owner-confirmed|owner-authorized|verified owner confirmation/i);
      },
    ));
  }
});

test('metadata verifier rejects a third hosted resource', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
      manifest.scope.miniapps.push({
        slug: 'third-module',
        title: 'Third Module',
        canonicalUrl: 'https://cabohealth.org/apps/third-module/',
        universalLink: 'https://cabohealth.org/apps/third-module/',
      });
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /exactly two approved miniapps/i);
    },
  );
});

test('metadata verifier enforces App Store localization limits', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'en-US.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Subtitle\n)[^\n]+/,
        'This subtitle is intentionally far beyond thirty characters',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /en-US subtitle exceeds 30 characters/i);
    },
  );
});

test('metadata verifier rejects Review Notes that omit a canonical module URL', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replaceAll(
        'https://cabohealth.org/apps/clinic-guide/',
        'https://cabohealth.org/apps/healthy-recipes/',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes missing canonical URL.*clinic-guide/i);
    },
  );
});

test('metadata verifier rejects an arbitrary third hosted resource in Review Notes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'At the time of submission, only these Universal Links enter.',
        '4. Meditation Studio — public — https://cabohealth.org/apps/meditation/\n\nAt the time of submission, only these Universal Links enter.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes contain an unapproved hosted-resource URL/i);
    },
  );
});

test('metadata verifier rejects a third Review Notes resource even without a URL', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'At the time of submission, only these Universal Links enter.',
        '4. Meditation Studio — public\n\nAt the time of submission, only these Universal Links enter.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Guideline 4\.7 resource list must contain exactly two public entries and one protected Client Resources entry/i);
    },
  );
});

test('metadata verifier rejects credentials in versioned Review Notes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, `${source}\nReviewer password: ExampleSecret123!\n`);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes appear to contain a credential/i);
    },
  );
});

test('metadata verifier rejects canonical CH and AR credentials in Review Notes', async (t) => {
  for (const code of [
    'CH-01234567-89ABCDEF-01234567-89ABCDEF',
    'AR-01234567-89ABCDEF-01234567-89ABCDEF',
  ]) {
    await t.test(code.slice(0, 2), () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, 'review-notes.md');
        writeFileSync(file, `${readFileSync(file, 'utf8')}\nApp Review credential: ${code}\n`);
      },
      (result) => {
        assert.equal(result.status, 1, `${code.slice(0, 2)} credential bypassed Review Notes scan`);
        assert.match(result.stderr, /appear to contain a credential/iu);
      },
    ));
  }
});

test('metadata verifier rejects credentials outside the paste-ready body, with spaced groups, or in another release checklist', async (t) => {
  const mutations = [
    ['before marker', 'review-notes.md', (source) => source.replace(
      '## Paste-ready body after all gates are resolved',
      'App Review credential: AR-01234567-89ABCDEF-01234567-89ABCDEF\n\n## Paste-ready body after all gates are resolved',
    )],
    ['spaced groups', 'review-notes.md', (source) => `${source}\nAR-0123 4567-89AB CDEF-0123 4567-89AB CDEF\n`],
    ['other checklist', 'submission-gates.md', (source) => `${source}\nCH-01234567-89ABCDEF-01234567-89ABCDEF\n`],
  ];
  for (const [name, relativePath, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, relativePath);
        writeFileSync(file, mutate(readFileSync(file, 'utf8')));
      },
      (result) => {
        assert.equal(result.status, 1, `${name} credential bypassed repository scan`);
        assert.match(result.stderr, /credential|CH or AR/iu);
      },
    ));
  }
});

test('metadata verifier rejects access credentials in project-level release authorities', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, 'release/data-inventory.md');
      writeFileSync(
        file,
        `${readFileSync(file, 'utf8')}\nApp Review credential: AR-01234567-89ABCDEF-01234567-89ABCDEF\n`,
      );
    },
    (result) => {
      assert.equal(result.status, 1, `project-level release credential bypassed scan:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /release\/data-inventory\.md.*CH or AR credential/iu);
    },
  );
});

test('metadata verifier never follows symbolic links in release authorities', () => {
  withReleaseFixture(
    (root) => {
      const path = join(root, 'release/data-inventory.md');
      rmSync(path);
      symlinkSync('content-rights.md', path);
    },
    (result) => {
      assert.equal(result.status, 1, `release authority symlink bypassed no-follow scan:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /must not be a symbolic link: release\/data-inventory\.md/iu);
    },
  );
});

test('metadata verifier rejects excluded modules in Review Notes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, `${source}\n3. Sleep Lab — public\n`);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes name excluded release scope/i);
    },
  );
});

test('metadata verifier rejects Review Notes that contradict the complimentary no-sale model', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          'ACCESS, BUSINESS MODEL, AND DATA',
          'Clinic access costs USD 99.\n\nACCESS, BUSINESS MODEL, AND DATA',
        ),
      );
    },
    (result) => {
      assert.equal(result.status, 1, `paid-access contradiction bypassed Review Notes verifier:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /Review Notes contradict.*complimentary no-sale model/iu);
    },
  );
});

test('metadata verifier rejects an external release gate marked ready', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
      manifest.gates.sellerLegalEntity = 'ready';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /sellerLegalEntity must remain owner-confirmed-individual/i);
    },
  );
});

test('metadata verifier preserves exact completed public-web evidence checkboxes', async (t) => {
  await t.test('the completed owner E2E gate cannot be reverted to pending', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          '- [x] Run a controlled production end-to-end check',
          '- [ ] Run a controlled production end-to-end check',
        ),
      );
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed owner Staff Access E2E checkbox/iu);
    },
  ));

  await t.test('the prior AASA deployment evidence cannot be reverted to pending', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      const prefix = '- [x] Preserve the prior seven-component AASA deployment evidence';
      const mutated = source.replace(prefix, prefix.replace('- [x]', '- [ ]'));
      assert.notEqual(mutated, source, 'AASA fixture must contain its exact completed gate');
      writeFileSync(file, mutated);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed AASA public-web evidence checkbox/iu);
    },
  ));

  await t.test('the completed dynamic AASA origin/CDN gate cannot be reverted to pending', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      const prefix = '- [x] Deploy the nine-component dynamic AASA authority';
      const mutated = source.replace(prefix, prefix.replace('- [x]', '- [ ]'));
      assert.notEqual(mutated, source, 'AASA fixture must contain its exact completed gate');
      writeFileSync(file, mutated);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed dynamic AASA origin\/CDN checkbox/iu);
    },
  ));

  await t.test('the completed dynamic protected broker gate cannot be reverted to pending', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      const prefix = '- [x] Promote and verify the dynamic structured private-content broker';
      const mutated = source.replace(prefix, prefix.replace('- [x]', '- [ ]'));
      assert.notEqual(mutated, source, 'protected broker fixture must contain its exact completed gate');
      writeFileSync(file, mutated);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact completed dynamic protected-broker checkbox/iu);
    },
  ));

  await t.test('physical App Attest valid-flow remains pending', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      const prefix = '- [ ] On physical iPhones with App Attest, prove valid credential resource selection';
      const mutated = source.replace(prefix, prefix.replace('- [ ]', '- [x]'));
      assert.notEqual(mutated, source, 'physical App Attest fixture must contain its exact pending gate');
      writeFileSync(file, mutated);
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /must retain the exact pending physical App Attest valid-flow checkbox/iu);
    },
  ));

  const completedRevisedPublicWebGatePrefixes = [
    ['promotion', '- [x] Promote and origin-verify the revised Healthy Recipes and Clinic Guide citation bytes plus the updated Privacy disclosure'],
    ['payload verification', '- [x] Verify the revised two-miniapp/Privacy payload is exact and no WordPress or unrelated file changes occurred during promotion.'],
  ];
  for (const [name, prefix] of completedRevisedPublicWebGatePrefixes) {
    await t.test(`the completed revised ${name} gate cannot be reverted to pending`, () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, 'submission-gates.md');
        const source = readFileSync(file, 'utf8');
        const mutated = source.replace(prefix, prefix.replace('- [x]', '- [ ]'));
        assert.notEqual(mutated, source, `${name} fixture must contain its exact completed gate`);
        writeFileSync(file, mutated);
      },
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, /must retain every exact completed revised public-web checkbox/iu);
      },
    ));
  }

  await t.test('an unrelated completed gate remains rejected', () => withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'submission-gates.md');
      const source = readFileSync(file, 'utf8');
      const mutated = source.replace(/^- \[ \] /mu, '- [x] ');
      assert.notEqual(mutated, source, 'submission-gates fixture must contain an unrelated pending checkbox');
      writeFileSync(
        file,
        mutated,
      );
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /unsupported completed evidence checkbox/iu);
    },
  ));
});

test('metadata verifier rejects owner, category, territory, platform, rights, and external-gate drift', async (t) => {
  const mutations = [
    ['separate legal entity', (manifest) => { manifest.ownerSeller.brandIsSeparateLegalEntity = true; }, /brand must not be represented as a separate legal entity/i],
    ['registered organization', (manifest) => { manifest.ownerSeller.registeredOrganization = true; }, /seller must remain an individual/i],
    ['seller mismatch', (manifest) => { manifest.ownerSeller.legalSeller = 'Another Seller'; }, /legal seller must remain Ivan Guaderrama/i],
    ['owner territory drift', (manifest) => { manifest.ownerSeller.releaseTerritories = ['FRA']; }, /owner release territories must be exactly MEX and USA/i],
    ['Medical category retained', (manifest) => { manifest.appStoreDraft.categories.primary = 'Medical'; }, /categories must replace Medical with Health & Fitness and Food & Drink/i],
    ['extra territory', (manifest) => { manifest.appStoreDraft.availability.territories.push('CAN'); }, /territories must be exactly MEX and USA/i],
    ['DSA EU reassessment disabled', (manifest) => {
      manifest.appStoreDraft.dsa.reassessBeforeAddingEuTerritory = false;
    }, /DSA must require reassessment before adding any EU territory/i],
    ['DSA global account state changed', (manifest) => {
      manifest.appStoreDraft.dsa.globalAccountState = 'changed';
    }, /DSA draft must not change global account state/i],
    ['DSA release territories mismatch availability', (manifest) => {
      manifest.appStoreDraft.dsa.releaseTerritories = ['MEX'];
    }, /DSA release territories must be exactly MEX and USA/i],
    ['automatic future territories', (manifest) => { manifest.appStoreDraft.availability.automaticFutureTerritories = true; }, /automatic future territories must remain disabled/i],
    ['Mac Apple Silicon enabled', (manifest) => { manifest.appStoreDraft.availability.macAppleSiliconAvailable = true; }, /Mac Apple Silicon availability must remain off/i],
    ['Vision Pro enabled', (manifest) => { manifest.appStoreDraft.availability.visionProAvailable = true; }, /Vision Pro availability must remain off/i],
    ['legacy Content Rights No', (manifest) => {
      manifest.appStoreDraft.contentRights.recommendedAnswer = 'No';
      manifest.appStoreDraft.contentRights.usesThirdPartyMaterial = false;
    }, /Content Rights recommendation must remain Yes while the revised inventory awaits owner reconfirmation and per-family rights basis/i],
    ['ASC marked saved', (manifest) => { manifest.appStoreDraft.status = 'saved'; }, /App Store draft must remain pending-save/i],
    ['DSA marked saved', (manifest) => { manifest.appStoreDraft.dsa.status = 'saved'; }, /DSA status must remain pending-save/i],
    ['medical-device gate completed', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.regulatedMedicalDevice = 'complete'; }, /regulatedMedicalDevice must remain owner-confirmed-pending-exact-rc-review/i],
    ['privacy gate completed', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.finalPrivacyDisclosure = 'complete'; }, /finalPrivacyDisclosure must remain pending-final-linkage-category-review-and-save/i],
    ['rights gate completed', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.allContentRights = 'complete'; }, /allContentRights must remain inventory-revised-pending-owner-reconfirmation-and-per-family-basis/i],
    ['revised public payload gate reverted', (manifest) => { manifest.gates.hostedLegalClientAccess = 'pending-revised-public-payload-redeploy-and-verification'; }, /hostedLegalClientAccess must remain deployed-and-verified-revised-public-payload/i],
    ['revised public payload unresolved record reverted', (manifest) => { manifest.appStoreDraft.unresolvedExternalGates.hostedLegalClientAccess = 'pending-revised-public-payload-redeploy-and-verification'; }, /hostedLegalClientAccess must remain deployed-and-verified-revised-public-payload/i],
    ['revised rights inventory gate completed', (manifest) => { manifest.gates.contentRights = 'complete'; }, /contentRights must remain inventory-revised-pending-owner-reconfirmation-and-per-family-basis/i],
    ['brand and rights gate completed', (manifest) => { manifest.gates.brandAndContentRights = 'complete'; }, /brandAndContentRights must remain pending-owner-reconfirmation-signed-declaration-and-per-family-rights-basis/i],
  ];

  for (const [name, mutate, expected] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/release-manifest.json`, (manifest) => {
        addOwnerSellerDraft(manifest);
        mutate(manifest);
      }),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, expected);
      },
    ));
  }
});

test('metadata verifier rejects Review Notes without the individual seller and trade-brand disclosure', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'This app is submitted by Ivan Guaderrama, an individual Apple Developer Program member. Cabo Health is a trade brand owned and operated by Ivan Guaderrama and is not represented as a separate legal entity.',
        'Cabo Health submits this app as an organization.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Review Notes missing the individual seller and trade-brand disclosure/i);
    },
  );
});

test('metadata verifier rejects contradictory Cabo Health entity claims while retaining the truthful disclosure', async (t) => {
  const mutations = [
    ['Review Notes', 'review-notes.md', (source) => `${source}\nCabo Health is a registered organization.\n`],
    ['brand rights draft', 'content-rights-and-brand.md', (source) => `${source}\nCabo Health operates as a company.\n`],
    ['declarations draft', 'declarations.md', (source) => `${source}\nCabo Health is a legal entity.\n`],
    ['submission gates', 'submission-gates.md', (source) => `${source}\nCabo Health, a separate company, submits this app.\n`],
    ['en-US public metadata', 'en-US.md', (source) => source.replace(
      'CaboHealth brings science-grounded general-wellness resources into one calm, bilingual experience.',
      'Cabo Health is a company.\n\nCaboHealth brings science-grounded general-wellness resources into one calm, bilingual experience.',
    )],
    ['App Privacy draft', 'app-privacy.md', (source) => `${source}\nCabo Health has been registered as an organization.\n`],
    ['es-MX public metadata', 'es-MX.md', (source) => `${source}\nCabo Health es una empresa y organización legal registrada.\n`],
    ['es-MX public metadata', 'es-MX.md', (source) => `${source}\nCabo Health es una compañía registrada.\n`],
  ];

  for (const [label, relativePath, mutate] of mutations) {
    await t.test(label, () => withReleaseFixture(
      (root) => {
        const file = join(root, releasePath, relativePath);
        const source = readFileSync(file, 'utf8');
        writeFileSync(file, mutate(source));
      },
      (result) => {
        assert.equal(result.status, 1, `${label} contradiction bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(
          result.stderr,
          new RegExp(`${label} contradicts.*legal entity, company, or organization`, 'i'),
        );
      },
    ));
  }
});

test('metadata verifier permits ordinary Apple Developer Program and third-party organization references', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'review-notes.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        '## Paste-ready body after all gates are resolved',
        'Apple is a third-party organization.\n\n## Paste-ready body after all gates are resolved',
      ));
    },
    (result) => assert.equal(result.status, 0, result.stderr || result.stdout),
  );
});

test('metadata verifier rejects a data inventory that claims the audit stores actor UID', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, 'release/data-inventory.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        'fixed `actorLabel: Staff`, target suffix or opaque ID',
        'actor UID, target type or opaque ID',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /fixed Staff actor label without an actor UID/iu);
    },
  );
});

test('metadata verifier rejects an ownership declaration that claims a registered Cabo Health organization', () => {
  withReleaseFixture(
    (root) => {
      writeFileSync(
        join(root, releasePath, 'unsigned-ownership-declaration.md'),
        '# Signed ownership declaration\n\nCabo Health is a registered organization and legal entity.\n',
      );
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /ownership declaration must remain unsigned|must not claim.*legal entity|registered organization/i);
    },
  );
});

test('metadata verifier reconciles authoritative Task 7 facts and configured app identity', async (t) => {
  const mutations = [
    ['changed legal sign-off', (root) => mutateJson(root, 'release/compliance-facts.json', (facts) => {
      facts.legalEntity.legalSignOffStatus = 'verified';
    }), /authoritative legal sign-off status no longer matches/i],
    ['configured app rolled back', (root) => mutateJson(root, 'app.json', (app) => {
      app.expo.version = '2.0.0';
      app.expo.ios.buildNumber = '3';
    }), /manifest says appJsonUpdated=true.*3\.0\/build 11/i],
    ['premature release-ready saved age authority', (root) => mutateJson(
      root,
      'release/compliance-facts.json',
      (facts) => {
        facts.releaseReady = true;
        facts.slice = 'task-7f-age-rating-saved';
      },
    ), /pending build-11 age-review root\/legal facts/i],
    ['third actual catalog slug', (root) => {
      const file = join(root, 'constants/publicMiniapps.ts');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        "['healthy-recipes', 'clinic-guide'] as const",
        "['healthy-recipes', 'clinic-guide', 'meditation'] as const",
      ));
    }, /authoritative catalog must contain exactly the two approved slugs/i],
  ];

  for (const [name, mutate, expected] of mutations) {
    await t.test(name, () => withReleaseFixture(
      mutate,
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, expected);
      },
    ));
  }
});

test('current release instructions retain the current build-11 candidate and its invalidated input history', () => {
  const dataInventory = readFileSync(join(projectRoot, 'release/data-inventory.md'), 'utf8');
  assert.match(dataInventory, /exact signed 3\.0\/build 11 RC must independently confirm/iu);
  assert.match(dataInventory, /Final Apple App Privacy answers must be reconciled against the exact 3\.0\/build 11 signed RC/iu);
  assert.match(dataInventory, /live authority phase—pre-input, input, artifact, RC, or submit-tool—must be determined from the exact current pins and required attestation bytes/iu);
  assert.match(dataInventory, /Build 10 is immutable processed internal-TestFlight history and cannot authorize build 11/iu);
  assert.match(dataInventory, /Build 11 input attempt 1 is separately archived invalidated-pre-provider source-drift history and cannot authorize a build or make build 11 historical/iu);
  assert.doesNotMatch(dataInventory, /exact signed 3\.0\/build [67] RC must/iu);
  assert.doesNotMatch(dataInventory, /exact 3\.0\/build [67] signed RC.*still pending/iu);

  const activation = readFileSync(
    join(projectRoot, 'docs/operations/dynamic-miniapp-production-activation-2026-08-25.md'),
    'utf8',
  );
  assert.match(activation, /CaboHealth 3\.0 build 11 is the current\s+candidate/iu);
  assert.match(activation, /live authority phase—pre-input, input, artifact, RC, or submit-tool—must be determined\s+from the exact current pins and required attestation bytes/iu);
  assert.match(activation, /Build 9 was input-attested and then aborted before any\s+provider operation/iu);
  assert.match(activation, /Build 10 was built, attested, uploaded, and processed for internal\s+TestFlight; its immutable history cannot authorize build 11/iu);
  assert.doesNotMatch(activation, /build [67] is the next candidate/iu);

  for (const relativePath of [
    'docs/operations/dynamic-miniapp-catalog.md',
    'docs/operations/protected-overlay-dynamic-activation-2026-08-26.md',
    'docs/operations/vip-showcase-production-activation-2026-08-26.md',
  ]) {
    const source = readFileSync(join(projectRoot, relativePath), 'utf8');
    assert.match(source, /3\.0(?:\/build | build )11/iu, relativePath);
    assert.match(source, /build 9[^.]*aborted(?:-pre-provider| before any provider operation)/iu, relativePath);
    assert.doesNotMatch(source, /exact signed 3\.0\/build [67]|source for CaboHealth 3\.0 build [67]/iu, relativePath);
  }
});

test('metadata verifier rejects build 6 or 7 as the next exact RC authority', async (t) => {
  const mutations = [
    ['build 7 in primary Firebase mapping gate', (root) => {
      const path = join(root, 'release/data-inventory.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        'exact signed 3.0/build 11 RC must independently confirm',
        'exact signed 3.0/build 7 RC must independently confirm',
      ));
    }],
    ['build 6 in reconciliation gate', (root) => {
      const path = join(root, 'release/data-inventory.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        'against the exact 3.0/build 11 signed RC',
        'against the exact 3.0/build 6 signed RC',
      ));
    }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(mutate, (result) => {
      assert.equal(result.status, 1, `${name} bypassed exact-RC validation`);
      assert.match(result.stderr, /must name build 11 as the phase-neutral exact RC, with build 8 immutable, build 9 aborted pre-provider, build 10 processed internal-TestFlight history, and build 11 input attempt 1 separately invalidated/iu);
    }));
  }
});

test('metadata verifier rejects Data Not Collected for the retained v3 architecture', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
      privacy.recommendedAppPrivacyAnswer = 'No, we do not collect data from this app';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /App Privacy collection answer must remain Yes, we collect data from this app/i);
    },
  );
});

test('metadata verifier rejects App Privacy prose that drifts from its JSON authority', () => {
  withReleaseFixture(
    (root) => {
      writeFileSync(
        join(root, releasePath, 'app-privacy.md'),
        '# App Privacy\n\nData Not Collected. Saved in App Store Connect.\n',
      );
    },
    (result) => {
      assert.equal(result.status, 1, `contradictory App Privacy prose bypassed verifier:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /app-privacy\.md.*exact reviewed prose/iu);
    },
  );
});

test('metadata verifier rejects App Privacy fields outside the observed log record', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/app-privacy.json`, (privacy) => {
      privacy.hostedTechnicalRequestLogs.observedFields.push('request header');
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Hosting request-log facts must retain the owner-authorized/i);
    },
  );
});

test('metadata verifier rejects unapproved App Privacy purposes and schema keys', async (t) => {
  const mutations = [
    ['marketing purpose', (privacy) => {
      privacy.hostedTechnicalRequestLogs.purpose = ['page delivery', 'Targeted Advertising'];
    }],
    ['extra hosted-log key', (privacy) => {
      privacy.hostedTechnicalRequestLogs.unexpected = true;
    }],
    ['extra native-behavior key', (privacy) => {
      privacy.nativeBehavior.unexpected = true;
    }],
    ['extra Cloud Functions request-security key', (privacy) => {
      privacy.cloudFunctionRequestSecurity.unexpected = true;
    }],
    ['extra access-artifact key', (privacy) => {
      privacy.accessArtifacts.unexpected = true;
    }],
    ['extra deletion key', (privacy) => {
      privacy.deletion.unexpected = true;
    }],
    ['extra deletion-receipt key', (privacy) => {
      privacy.deletionReceiptStatus.unexpected = true;
    }],
    ['extra deletion-status-response key', (privacy) => {
      privacy.deletionReceiptStatus.statusResponse.unexpected = true;
    }],
    ['extra audit key', (privacy) => {
      privacy.applicationAudit.unexpected = true;
    }],
    ['extra review-sandbox key', (privacy) => {
      privacy.reviewSandbox.unexpected = true;
    }],
    ['extra conditional-recommendation key', (privacy) => {
      privacy.conditionalRecommendation.unexpected = true;
    }],
    ['extra root key', (privacy) => {
      privacy.unexpected = true;
    }],
    ['audit exposes resource URLs', (privacy) => {
      privacy.applicationAudit.containsResourceUrls = true;
    }],
    ['audit purpose drift', (privacy) => {
      privacy.applicationAudit.purpose = 'analytics';
    }],
    ['audit deadline drift', (privacy) => {
      privacy.applicationAudit.deletionDeadlineDays = 31;
    }],
    ['audit physical TTL promise', (privacy) => {
      privacy.applicationAudit.physicalTtlDeletionAsynchronous = false;
    }],
    ['advertising provisional purpose', (privacy) => {
      privacy.conditionalRecommendation.provisionalPurpose = ['Targeted Advertising'];
    }],
    ['missing signed FirebaseAuth Analytics purpose', (privacy) => {
      privacy.conditionalRecommendation.provisionalPurpose = ['App Functionality'];
    }],
    ['non-Apple fraud purpose taxonomy', (privacy) => {
      privacy.conditionalRecommendation.provisionalPurpose = [
        'App Functionality',
        'Fraud Prevention, Security, and Compliance',
      ];
    }],
    ['coarse location omitted', (privacy) => {
      privacy.conditionalRecommendation.provisionalCategoryMapping =
        privacy.conditionalRecommendation.provisionalCategoryMapping
          .filter((entry) => !entry.startsWith('Coarse Location'));
    }],
    ['group label instead of selectable data type', (privacy) => {
      privacy.conditionalRecommendation.provisionalCategoryMapping[0] = 'Identifiers';
    }],
    ['native resource URL omitted', (privacy) => {
      privacy.backend.resourceUrlsReturnedToNative = false;
    }],
    ['VIP preview URL exposed', (privacy) => {
      privacy.resourceUrlHandling ??= {
        publicV3CatalogRecordsContainExternalUrl: true,
        authorizedVipV2LaunchMayReturnExternalUrlTransiently: true,
        vipPreviewsContainExternalUrl: false,
        vipGrantsContainExternalUrl: false,
        nativeStorageContainsExternalUrl: false,
        applicationAuditContainsExternalUrl: false,
      };
      privacy.resourceUrlHandling.vipPreviewsContainExternalUrl = true;
    }],
    ['destination network data denied', (privacy) => {
      privacy.thirdPartyNetworkRequests ??= {
        behavior: 'third-party-network-request',
        destinationHostReceivesNormalNetworkData: true,
        destinationOperatesIndependently: true,
        finalAppleMappingStatus: 'pending-final-destination-provider-and-category-review',
      };
      privacy.thirdPartyNetworkRequests.destinationHostReceivesNormalNetworkData = false;
    }],
    ['debug App Check provider', (privacy) => {
      privacy.appCheck.providers = ['debug'];
    }],
    ['best-effort deletion', (privacy) => {
      privacy.deletion.mechanism = 'best effort';
    }],
    ['production deletion path drift', (privacy) => {
      privacy.deletion.activeUserPath = 'Settings';
    }],
    ['production deletion response drift', (privacy) => {
      privacy.deletion.responseStatuses = ['completed'];
    }],
    ['production expiry does not enqueue', (privacy) => {
      privacy.deletion.grantExpiryQueuesDeletion = false;
    }],
    ['production administrator revocation does not enqueue', (privacy) => {
      privacy.deletion.administratorRevocationQueuesDeletion = false;
    }],
    ['production retry interval drift', (privacy) => {
      privacy.deletion.retryWorkerMinutes = 10;
    }],
    ['deletion receipt entropy drift', (privacy) => {
      privacy.deletionReceiptStatus.receiptEntropyBits = 128;
    }],
    ['deletion receipt encoding drift', (privacy) => {
      privacy.deletionReceiptStatus.receiptEncoding = 'hex';
    }],
    ['deletion receipt storage drift', (privacy) => {
      privacy.deletionReceiptStatus.nativeStorage = 'AsyncStorage';
    }],
    ['deletion receipt prepared timing drift', (privacy) => {
      privacy.deletionReceiptStatus.preparedBeforeDeletionRequest = false;
    }],
    ['deletion receipt delete payload drift', (privacy) => {
      privacy.deletionReceiptStatus.deleteRequestFields = ['deletionReceipt'];
    }],
    ['deletion receipt status payload drift', (privacy) => {
      privacy.deletionReceiptStatus.statusRequestFields = ['uid'];
    }],
    ['deletion receipt response drift', (privacy) => {
      privacy.deletionReceiptStatus.statusResponse.statuses = ['completed'];
    }],
    ['deletion receipt App Check disabled', (privacy) => {
      privacy.deletionReceiptStatus.limitedUseAppCheckRequired = false;
    }],
    ['deletion receipt requires deleted Auth session', (privacy) => {
      privacy.deletionReceiptStatus.firebaseAuthenticationRequired = true;
    }],
    ['raw deletion receipt stored', (privacy) => {
      privacy.deletionReceiptStatus.rawReceiptStoredServerSide = true;
    }],
    ['deletion receipt lookup unkeyed', (privacy) => {
      privacy.deletionReceiptStatus.serverLookupRepresentation = 'plain SHA-256';
    }],
    ['deletion receipt realm collections merged', (privacy) => {
      privacy.deletionReceiptStatus.reviewCollection = privacy.deletionReceiptStatus.productionCollection;
    }],
    ['deletion receipt realm peppers merged', (privacy) => {
      privacy.deletionReceiptStatus.separateRealmPeppers = false;
    }],
    ['deletion receipt status includes UID', (privacy) => {
      privacy.deletionReceiptStatus.statusRecordContainsUid = true;
    }],
    ['deletion expected-completion guarantee invented', (privacy) => {
      privacy.deletionReceiptStatus.expectedCompletionGuaranteed = true;
    }],
    ['pending deletion receipt TTL enabled', (privacy) => {
      privacy.deletionReceiptStatus.pendingHasTtl = true;
    }],
    ['completed deletion receipt retention drift', (privacy) => {
      privacy.deletionReceiptStatus.completedRetentionDays = 31;
    }],
    ['completed deletion receipt TTL promise', (privacy) => {
      privacy.deletionReceiptStatus.completedPhysicalTtlDeletionAsynchronous = false;
    }],
    ['deletion receipt reopen check disabled', (privacy) => {
      privacy.deletionReceiptStatus.checksOnClientResourcesReopen = false;
    }],
    ['deletion completion confirmation disabled', (privacy) => {
      privacy.deletionReceiptStatus.completionConfirmationInApp = false;
    }],
    ['prepared missing receipt is cleared', (privacy) => {
      privacy.deletionReceiptStatus.preparedNotFoundClearsReceipt = true;
    }],
    ['prepared missing receipt restores access', (privacy) => {
      privacy.deletionReceiptStatus.preparedNotFoundRestoresAccess = true;
    }],
    ['prepared missing receipt changes on resubmission', (privacy) => {
      privacy.deletionReceiptStatus.preparedNotFoundResubmitsSameReceipt = false;
    }],
    ['accepted missing receipt restores access', (privacy) => {
      privacy.deletionReceiptStatus.acceptedNotFoundRestoresAccess = true;
    }],
    ['review self-deletion disabled', (privacy) => {
      privacy.reviewSandbox.userInitiatedDeletion = false;
    }],
    ['review deletion response drift', (privacy) => {
      privacy.reviewSandbox.responseStatuses = ['pending'];
    }],
    ['review inactivity eligibility drift', (privacy) => {
      privacy.reviewSandbox.currentIdentityInactivityEligibilityDays = 31;
    }],
    ['review stale-generation delay', (privacy) => {
      privacy.reviewSandbox.staleGenerationEligibility = 'after 30 days';
    }],
    ['review retry interval drift', (privacy) => {
      privacy.reviewSandbox.retryWorkerMinutes = 10;
    }],
    ['review completion guarantee', (privacy) => {
      privacy.reviewSandbox.completionTimeGuaranteed = true;
    }],
    ['raw source IP persisted in Firestore', (privacy) => {
      privacy.cloudFunctionRequestSecurity.rawSourceIpStoredInFirestore = true;
    }],
    ['Cloud Run request-log retention drift', (privacy) => {
      privacy.cloudRunRequestLogs.retentionDays = 31;
    }],
    ['Cloud Run request-log exclusion claim drift', (privacy) => {
      privacy.cloudRunRequestLogs.defaultSinkExclusionConfigured = true;
    }],
    ['rate-limit representation drift', (privacy) => {
      privacy.cloudFunctionRequestSecurity.storedRateLimitRepresentation = 'raw IP address';
    }],
    ['rate-limit deadline drift', (privacy) => {
      privacy.cloudFunctionRequestSecurity.rateLimitBucketDeletionDeadlineMinutes = 31;
    }],
    ['rate-limit tracking enabled', (privacy) => {
      privacy.cloudFunctionRequestSecurity.tracking = true;
    }],
    ['redemption request deadline drift', (privacy) => {
      privacy.accessArtifacts.redemptionRequestDigestDeadlineMinutes = 6;
    }],
    ['launch nonce deadline drift', (privacy) => {
      privacy.accessArtifacts.launchNonceDeadlineSeconds = 61;
    }],
    ['web session maximum drift', (privacy) => {
      privacy.accessArtifacts.webSessionMaximumMinutes = 61;
    }],
    ['broker replay deadline drift', (privacy) => {
      privacy.accessArtifacts.brokerReplayDigestDeadlineMinutes = 3;
    }],
    ['tombstone TTL enabled', (privacy) => {
      privacy.accessArtifacts.deletionTombstoneHasTtl = true;
    }],
    ['plaintext access artifact', (privacy) => {
      privacy.accessArtifacts.containsPlaintextSecrets = true;
    }],
    ['saved client linkage', (privacy) => {
      privacy.clientAccount.status = 'saved';
    }],
    ['unkeyed code digest', (privacy) => {
      privacy.backend.codeDigests = 'plain SHA-256';
    }],
    ['missing backend providers', (privacy) => {
      privacy.backend.providers = [];
    }],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/app-privacy.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} bypassed verifier:\n${result.stdout}${result.stderr}`);
        assert.match(result.stderr, /App Privacy schemas and hosting purposes must be exact|App Privacy client-access architecture|conditional App Privacy mapping|exact privacy authority/iu);
      },
    ));
  }
});

test('metadata verifier requires unrestricted web access for the dynamic external WebView capability', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/age-rating.json`, (age) => {
      age.conditions.unrestrictedWebAccess.requiredAnswer = false;
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /Dynamic embedded third-party web access requires unrestrictedWebAccess=true/i);
    },
  );
});

test('metadata verifier rejects age-rating prose that drifts from its JSON authority', () => {
  withReleaseFixture(
    (root) => {
      writeFileSync(
        join(root, releasePath, 'age-rating.md'),
        '# Age rating\n\nFinal calculated rating: 17+. Advertising: Yes.\n',
      );
    },
    (result) => {
      assert.equal(result.status, 1, `contradictory age-rating prose bypassed verifier:\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /age-rating\.md.*exact reviewed prose/iu);
    },
  );
});

test('metadata verifier requires the exact projected 16+ and legacy 17+ ratings with pending recalculation state', async (t) => {
  const mutations = [
    ['previous saved rating removed', (age) => { age.previousSavedRating = null; }],
    ['calculated rating filled before ASC save', (age) => { age.calculatedRating = '16+'; }],
    ['current projected rating lowered', (age) => { age.projectedRating = '9+'; }],
    ['legacy rating lowered', (age) => { age.legacyOperatingSystemsRating = '12+'; }],
    ['draft status restored', (age) => { age.status = 'draft-conditional'; }],
    ['owner confirmation falsely closed', (age) => { age.ownerConfirmationRequired = false; }],
    ['App Store calculation falsely closed', (age) => { age.appStoreCalculationRequired = false; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/age-rating.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(result.stderr, /Age rating must remain projected 16\+ with legacy 17\+, owner reconfirmation, and App Store recalculation required/i);
      },
    ));
  }
});

test('metadata verifier rejects extra or contradictory age-rating answers', async (t) => {
  const mutations = [
    ['UGC changed to yes', (age) => { age.otherSupportedAnswers.userGeneratedContent = true; }],
    ['medical information changed', (age) => { age.conditions.medicalOrTreatmentInformation.requiredAnswer = 'INFREQUENT'; }],
    ['health topics changed from presence value', (age) => { age.conditions.healthOrWellnessTopics.requiredAnswer = 'FREQUENT'; }],
    ['violence changed', (age) => { age.otherSupportedAnswers.violenceRealistic = 'INFREQUENT'; }],
    ['questionnaire scale changed', (age) => { age.questionnaireReference.frequencyScale = ['NONE', 'FREQUENT']; }],
    ['kids band enabled', (age) => { age.ageCategoryAndOverride.kidsAgeBand = 'FIVE_AND_UNDER'; }],
    ['extra condition', (age) => { age.conditions.unexpected = { requiredAnswer: false }; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/age-rating.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, result.stdout || result.stderr);
        assert.match(
          result.stderr,
          /age-rating condition and supported-answer schemas must be exact|exact age-rating authority|Age rating must remain|requires (?:medicalOrTreatmentInformation|healthOrWellnessTopics)/i,
        );
      },
    ));
  }
});

test('metadata verifier binds screenshot planning to the exact candidate build', () => {
  withReleaseFixture(
    (root) => mutateJson(root, `${releasePath}/screenshots-manifest.json`, (screenshots) => {
      screenshots.buildNumber = '4';
    }),
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /screenshot manifest must target 3\.0 build 11/i);
    },
  );
});

test('metadata verifier rejects screenshot schema and evidence-authority drift', async (t) => {
  const mutations = [
    ['schema', (screenshots) => { screenshots.schemaVersion = 999; }],
    ['evidence keys', (screenshots) => { screenshots.requiredEvidence = {}; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => withReleaseFixture(
      (root) => mutateJson(root, `${releasePath}/screenshots-manifest.json`, mutate),
      (result) => {
        assert.equal(result.status, 1, `${name} screenshot drift bypassed verifier`);
        assert.match(result.stderr, /Screenshot manifest must retain the exact authority schema/iu);
      },
    ));
  }
});

test('metadata verifier accepts the exact file-backed screenshot RC phase and rejects byte drift', async (t) => {
  await t.test('exact final RC', () => withReleaseFixture(
    (root) => writeFinalScreenshotAuthority(root),
    (result) => {
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  ));
  await t.test('image byte drift', () => withReleaseFixture(
    (root) => {
      const captures = writeFinalScreenshotAuthority(root);
      writeFileSync(
        join(root, 'release/private/rc-build-11', captures[0].relativePath),
        screenshotPng(1320, 2868, 'drifted'),
        { mode: 0o600 },
      );
    },
    (result) => {
      assert.equal(result.status, 1, 'file-backed screenshot byte drift bypassed verifier');
      assert.match(result.stderr, /exact file-backed RC authority/iu);
    },
  ));
});

test('metadata verifier rejects public copy that presents the app as a generic marketplace', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'es-MX.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Promotional Text\n)[^\n]+/,
        'Un marketplace para instalar muchas aplicaciones.',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /es-MX public metadata contains forbidden marketplace framing/i);
    },
  );
});

test('metadata verifier rejects an empty required localization field', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'en-US.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Description\n)[\s\S]*?(?=\n## Keywords)/,
        '',
      ));
    },
    (result) => {
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.match(result.stderr, /en-US Description must not be empty/i);
    },
  );
});

test('metadata verifier counts Apple localization limits by characters, not UTF-8 bytes', () => {
  withReleaseFixture(
    (root) => {
      const file = join(root, releasePath, 'es-MX.md');
      const source = readFileSync(file, 'utf8');
      writeFileSync(file, source.replace(
        /(?<=## Keywords\n)[^\n]+/,
        `salud,${'é'.repeat(90)}`,
      ));
    },
    (result) => assert.equal(result.status, 0, result.stderr || result.stdout),
  );
});
