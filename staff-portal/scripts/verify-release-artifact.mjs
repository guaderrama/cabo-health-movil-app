import { readFileSync } from 'node:fs';

import { verifyStaffReleaseArtifact } from './staff-release-gate.mjs';

const manifestPath = readArgument('--manifest');
const distDir = readArgument('--dist');
const artifact = JSON.parse(readFileSync(manifestPath, 'utf8'));
const verified = verifyStaffReleaseArtifact({
  artifact,
  distDir,
  expectedIdentity: {
    appEnv: process.env.APP_ENV,
    expectedProjectId: process.env.STAFF_EXPECTED_FIREBASE_PROJECT_ID,
    expectedWebAppId: process.env.STAFF_EXPECTED_FIREBASE_WEB_APP_ID,
    backendStaffWebAppId: process.env.STAFF_WEB_FIREBASE_APP_ID,
    functionsRegion: process.env.VITE_FIREBASE_FUNCTIONS_REGION,
  },
  expectedReleaseId: process.env.STAFF_EXPECTED_RELEASE_ID,
  expectedInventorySha256: process.env.STAFF_EXPECTED_INVENTORY_SHA256,
  expectedArtifactSha256: process.env.STAFF_EXPECTED_ARTIFACT_SHA256,
});
process.stdout.write(`${JSON.stringify({ verified: true, releaseId: verified.releaseId })}\n`);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`required_argument_missing:${name}`);
  return value;
}
