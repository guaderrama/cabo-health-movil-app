import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createStaffReleaseArtifact } from './staff-release-gate.mjs';

const distDir = readArgument('--dist');
const outputPath = readArgument('--out');
const artifact = createStaffReleaseArtifact({
  distDir,
  identity: readIdentityFromEnvironment(),
});
writeFileSync(resolve(outputPath), `${JSON.stringify(artifact, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600,
});
process.stdout.write(`${JSON.stringify({
  releaseId: artifact.releaseId,
  inventorySha256: artifact.inventorySha256,
  artifactSha256: artifact.artifactSha256,
})}\n`);

function readIdentityFromEnvironment() {
  return {
    appEnv: process.env.APP_ENV,
    expectedProjectId: process.env.STAFF_EXPECTED_FIREBASE_PROJECT_ID,
    expectedWebAppId: process.env.STAFF_EXPECTED_FIREBASE_WEB_APP_ID,
    backendStaffWebAppId: process.env.STAFF_WEB_FIREBASE_APP_ID,
    functionsRegion: process.env.VITE_FIREBASE_FUNCTIONS_REGION,
  };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`required_argument_missing:${name}`);
  return value;
}
