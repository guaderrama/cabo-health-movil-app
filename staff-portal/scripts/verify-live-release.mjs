import { readFileSync } from 'node:fs';

import {
  STAFF_PRODUCTION_URL,
  verifyLiveStaffRelease,
} from './staff-release-gate.mjs';

const manifestPath = readArgument('--manifest');
const artifact = JSON.parse(readFileSync(manifestPath, 'utf8'));
const result = await verifyLiveStaffRelease({
  artifact,
  baseUrl: STAFF_PRODUCTION_URL,
  expectedReleaseId: process.env.STAFF_EXPECTED_RELEASE_ID,
  expectedInventorySha256: process.env.STAFF_EXPECTED_INVENTORY_SHA256,
  expectedArtifactSha256: process.env.STAFF_EXPECTED_ARTIFACT_SHA256,
});
process.stdout.write(`${JSON.stringify({ verified: true, ...result })}\n`);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`required_argument_missing:${name}`);
  return value;
}
