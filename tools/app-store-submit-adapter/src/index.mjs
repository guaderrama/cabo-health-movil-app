import { parseArguments } from './arguments.mjs';
import { loadCredentials } from './auth.mjs';
import { readAndValidateEvidence } from './evidence.mjs';
import { submitExactVersion } from './api.mjs';
import { AppStoreConnectTransport } from './transport.mjs';

export async function runAdapter(argv, {
  transport,
  environment = process.env,
  now = Date.now(),
  sleep,
} = {}) {
  const args = parseArguments(argv);
  const evidence = readAndValidateEvidence(args, { now });
  const liveTransport = transport ?? new AppStoreConnectTransport(
    loadCredentials(environment),
    { now: () => now },
  );
  return submitExactVersion(liveTransport, evidence.appStoreConnectEvidence, { sleep });
}

export { parseArguments } from './arguments.mjs';
export {
  readAndValidateEvidence,
  validateAppStoreConnectEvidence,
  validateBuildArtifact,
  validatePhysicalIphoneQa,
  validateRcAttestation,
  validateScreenshotsManifest,
} from './evidence.mjs';
export { submitExactVersion, resolveLiveIdentity, apiPaths, requestBodies } from './api.mjs';
export { AppStoreConnectTransport, FixtureTransport } from './transport.mjs';
export { createJwt, loadCredentials, CREDENTIAL_ENVIRONMENT_KEYS } from './auth.mjs';
export { AdapterError, publicErrorCode } from './errors.mjs';
export {
  CANDIDATE,
  METADATA_CHECK_IDS,
  QA_CHECK_IDS,
  SCREENSHOT_LOCALES,
  SCREENSHOT_SCENE_IDS,
  SCREENSHOT_SIZES,
} from './constants.mjs';
