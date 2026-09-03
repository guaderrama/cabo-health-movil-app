import assert from 'node:assert/strict';
import { chmodSync, linkSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseArguments,
  readAndValidateEvidence,
  validateAppStoreConnectEvidence,
  validateBuildArtifact,
  validatePhysicalIphoneQa,
  validateScreenshotsManifest,
} from '../src/index.mjs';
import { QA_CHECK_IDS } from '../src/constants.mjs';
import { sha256 } from '../src/files.mjs';
import {
  createEvidenceFixture,
  NOW,
  SOURCE_SHA,
  TESTFLIGHT_BUILD_ID,
  validAppStoreEvidence,
  validPhysicalQa,
  validScreenshots,
} from './helpers.mjs';

const bindings = {
  testFlightBuildId: TESTFLIGHT_BUILD_ID,
  sourceTreeSha256: SOURCE_SHA,
  testFlightProcessedAtMs: Date.parse('2026-08-25T17:30:00.000Z'),
};

test('build artifact rejects tampering with the reviewed EAS-to-IPA association', () => {
  const fixture = createEvidenceFixture();
  assert.doesNotThrow(() => validateBuildArtifact(fixture.buildArtifact, { now: NOW }));

  const tamperingCases = [
    ['IPA hash', (artifact) => { artifact.easArtifactAssociation.downloadedIpaSha256 = 'e'.repeat(64); }],
    ['build ID', (artifact) => { artifact.easArtifactAssociation.buildId = '87654321-1234-4234-8234-123456789abc'; }],
    ['build status', (artifact) => { artifact.easArtifactAssociation.buildStatus = 'ERRORED'; }],
    ['association guard', (artifact) => { artifact.easArtifactAssociation.associationGuardProven = true; }],
    ['association review chronology', (artifact) => { artifact.easArtifactAssociation.reviewedAt = '2026-08-25T17:00:00.001Z'; }],
    ['unexpected association field', (artifact) => { artifact.easArtifactAssociation.extra = true; }],
  ];
  for (const [name, tamper] of tamperingCases) {
    const tampered = structuredClone(fixture.buildArtifact);
    tamper(tampered);
    assert.throws(
      () => validateBuildArtifact(tampered, { now: NOW }),
      /BUILD_ARTIFACT_EVIDENCE_INVALID/u,
      name,
    );
  }
});

test('parses only the exact guard argument contract and fixed candidate', () => {
  const fixture = createEvidenceFixture();
  const parsed = parseArguments(fixture.args);
  assert.equal(parsed['apple-id'], '6758285327');
  assert.equal(parsed['testflight-build-id'], TESTFLIGHT_BUILD_ID);
  assert.throws(
    () => parseArguments([...fixture.args, '--extra', 'value']),
    /CLI_ARGUMENTS_INVALID/u,
  );
  const changed = [...fixture.args];
  changed[changed.indexOf('--bundle-identifier') + 1] = 'com.example.other';
  assert.throws(() => parseArguments(changed), /CANDIDATE_IDENTITY_INVALID/u);
  const duplicate = [...fixture.args];
  duplicate[duplicate.indexOf('--apple-id') + 2] = '--apple-id';
  assert.throws(() => parseArguments(duplicate), /CLI_ARGUMENTS_INVALID/u);
  assert.throws(
    () => parseArguments([...fixture.args.slice(0, -2), '--private-key', 'secret']),
    /CLI_ARGUMENTS_INVALID/u,
  );
});

test('accepts a fully cross-bound canonical evidence set', () => {
  const fixture = createEvidenceFixture();
  const evidence = readAndValidateEvidence(parseArguments(fixture.args), { now: NOW });
  assert.equal(evidence.rcAttestation.sourceTreeSha256, SOURCE_SHA);
  assert.equal(evidence.physicalIphoneQa.devices.length, 2);
  assert.equal(evidence.screenshotsManifest.captures.length, 16);
});

test('rejects evidence byte drift, noncanonical JSON, unsafe mode, and a stale RC binding', () => {
  {
    const fixture = createEvidenceFixture();
    writeFileSync(fixture.values['physical-iphone-qa'], '{}\n');
    assert.throws(
      () => readAndValidateEvidence(parseArguments(fixture.args), { now: NOW }),
      /PHYSICAL_IPHONE_QA_FILE_INVALID/u,
    );
  }
  {
    const fixture = createEvidenceFixture();
    const bytes = readFileSync(fixture.values['screenshots-manifest'], 'utf8');
    writeFileSync(fixture.values['screenshots-manifest'], bytes.trim());
    fixture.args[fixture.args.indexOf('--screenshots-manifest-sha256') + 1]
      = sha256(readFileSync(fixture.values['screenshots-manifest']));
    assert.throws(
      () => readAndValidateEvidence(parseArguments(fixture.args), { now: NOW }),
      /SCREENSHOTS_MANIFEST_FILE_INVALID/u,
    );
  }
  {
    const fixture = createEvidenceFixture();
    linkSync(
      fixture.values['build-artifact-attestation'],
      `${fixture.values['build-artifact-attestation']}.hardlink`,
    );
    assert.throws(
      () => readAndValidateEvidence(parseArguments(fixture.args), { now: NOW }),
      /BUILD_ARTIFACT_FILE_INVALID/u,
    );
  }
  {
    const fixture = createEvidenceFixture();
    chmodSync(fixture.values['app-store-connect-evidence'], 0o644);
    assert.throws(
      () => readAndValidateEvidence(parseArguments(fixture.args), { now: NOW }),
      /APP_STORE_CONNECT_EVIDENCE_FILE_INVALID/u,
    );
  }
  {
    const fixture = createEvidenceFixture();
    const changed = [...fixture.args];
    changed[changed.indexOf('--physical-iphone-qa-sha256') + 1] = 'f'.repeat(64);
    assert.throws(
      () => readAndValidateEvidence(parseArguments(changed), { now: NOW }),
      /PHYSICAL_IPHONE_QA_FILE_INVALID/u,
    );
  }
});

test('physical-iPhone QA requires two distinct clean/upgrade devices and every one of 13 checks including external WebView QA', () => {
  assert.equal(QA_CHECK_IDS.length, 13);
  assert.ok(QA_CHECK_IDS.includes('externalWebView'));
  assert.doesNotThrow(() => validatePhysicalIphoneQa(validPhysicalQa(), bindings, { now: NOW }));
  const missing = structuredClone(validPhysicalQa());
  delete missing.checks.externalWebView;
  assert.throws(
    () => validatePhysicalIphoneQa(missing, bindings, { now: NOW }),
    /PHYSICAL_IPHONE_QA_INVALID/u,
  );
  const sameInstall = structuredClone(validPhysicalQa());
  sameInstall.devices[1].installation = 'clean';
  assert.throws(
    () => validatePhysicalIphoneQa(sameInstall, bindings, { now: NOW }),
    /PHYSICAL_IPHONE_QA_INVALID/u,
  );
  const notHuman = structuredClone(validPhysicalQa());
  notHuman.humanSignOff = false;
  assert.throws(
    () => validatePhysicalIphoneQa(notHuman, bindings, { now: NOW }),
    /PHYSICAL_IPHONE_QA_INVALID/u,
  );
});

test('App Store Connect evidence requires all metadata gates and exact live resource IDs', () => {
  assert.doesNotThrow(() => validateAppStoreConnectEvidence(
    validAppStoreEvidence(), bindings, { now: NOW },
  ));
  const unchecked = structuredClone(validAppStoreEvidence());
  unchecked.metadataChecks.dsa = false;
  assert.throws(
    () => validateAppStoreConnectEvidence(unchecked, bindings, { now: NOW }),
    /APP_STORE_CONNECT_EVIDENCE_INVALID/u,
  );
  const wrongBuild = structuredClone(validAppStoreEvidence());
  wrongBuild.buildResourceId = '../not-an-asc-resource-id';
  assert.throws(
    () => validateAppStoreConnectEvidence(wrongBuild, bindings, { now: NOW }),
    /APP_STORE_CONNECT_EVIDENCE_INVALID/u,
  );
  const failure = structuredClone(validAppStoreEvidence());
  failure.failures.push('not ready');
  assert.throws(
    () => validateAppStoreConnectEvidence(failure, bindings, { now: NOW }),
    /APP_STORE_CONNECT_EVIDENCE_INVALID/u,
  );
});

test('screenshot evidence is exactly eight scenes in two locales at official 6.9-inch sizes', () => {
  assert.doesNotThrow(() => validateScreenshotsManifest(validScreenshots(), bindings, { now: NOW }));
  const duplicate = structuredClone(validScreenshots());
  duplicate.captures[15] = structuredClone(duplicate.captures[0]);
  duplicate.requiredEvidence.imageHashes[15] = duplicate.captures[0].sha256;
  assert.throws(
    () => validateScreenshotsManifest(duplicate, bindings, { now: NOW }),
    /SCREENSHOTS_MANIFEST_INVALID/u,
  );
  const unsafePath = structuredClone(validScreenshots());
  unsafePath.captures[0].relativePath = '../private.png';
  assert.throws(
    () => validateScreenshotsManifest(unsafePath, bindings, { now: NOW }),
    /SCREENSHOTS_MANIFEST_INVALID/u,
  );
  const wrongSize = structuredClone(validScreenshots());
  wrongSize.captures[0].width = 1179;
  assert.throws(
    () => validateScreenshotsManifest(wrongSize, bindings, { now: NOW }),
    /SCREENSHOTS_MANIFEST_INVALID/u,
  );
  const reorderedHashes = structuredClone(validScreenshots());
  reorderedHashes.requiredEvidence.imageHashes.reverse();
  assert.throws(
    () => validateScreenshotsManifest(reorderedHashes, bindings, { now: NOW }),
    /SCREENSHOTS_MANIFEST_INVALID/u,
  );
  const nonCanonicalCaptureOrder = structuredClone(validScreenshots());
  [nonCanonicalCaptureOrder.captures[0], nonCanonicalCaptureOrder.captures[1]] = [
    nonCanonicalCaptureOrder.captures[1],
    nonCanonicalCaptureOrder.captures[0],
  ];
  [
    nonCanonicalCaptureOrder.requiredEvidence.imageHashes[0],
    nonCanonicalCaptureOrder.requiredEvidence.imageHashes[1],
  ] = [
    nonCanonicalCaptureOrder.requiredEvidence.imageHashes[1],
    nonCanonicalCaptureOrder.requiredEvidence.imageHashes[0],
  ];
  assert.throws(
    () => validateScreenshotsManifest(nonCanonicalCaptureOrder, bindings, { now: NOW }),
    /SCREENSHOTS_MANIFEST_INVALID/u,
  );

  const nullByte = structuredClone(validScreenshots());
  nullByte.captures[0].relativePath = 'screenshots/en-US/iphone-6.9/01-launch\0.png';
  assert.throws(
    () => validateScreenshotsManifest(nullByte, bindings, { now: NOW }),
    /SCREENSHOTS_MANIFEST_INVALID/u,
  );
});

test('screenshot relative paths accept 512 JavaScript characters and reject 513', () => {
  const prefix = 'screenshots/en-US/iphone-6.9/';
  const extension = '.png';
  const pathAtLimit = `${prefix}${'a'.repeat(512 - prefix.length - extension.length)}${extension}`;
  const pathOverLimit = `${prefix}${'a'.repeat(513 - prefix.length - extension.length)}${extension}`;
  assert.equal(pathAtLimit.length, 512);
  assert.equal(pathOverLimit.length, 513);

  const valid = structuredClone(validScreenshots());
  valid.captures[0].relativePath = pathAtLimit;
  assert.doesNotThrow(() => validateScreenshotsManifest(valid, bindings, { now: NOW }));

  const invalid = structuredClone(validScreenshots());
  invalid.captures[0].relativePath = pathOverLimit;
  assert.throws(
    () => validateScreenshotsManifest(invalid, bindings, { now: NOW }),
    /SCREENSHOTS_MANIFEST_INVALID/u,
  );
});
