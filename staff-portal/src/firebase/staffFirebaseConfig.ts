import type { FirebaseOptions } from 'firebase/app';

export const STAFF_FUNCTIONS_REGION = 'us-central1' as const;

const DEDICATED_PROJECT_PATTERN = /^cabohealth-[a-z0-9](?:[a-z0-9-]{0,17}[a-z0-9])?$/u;
const WEB_APP_ID_PATTERN = /^1:[0-9]{6,20}:web:[0-9a-f]{8,64}$/u;

export interface StaffFirebaseConfig {
  readonly firebase: FirebaseOptions;
  readonly appCheckSiteKey: string;
  readonly functionsRegion: typeof STAFF_FUNCTIONS_REGION;
}

export function validateStaffFirebaseConfig(value: unknown): StaffFirebaseConfig {
  if (!isRecord(value)
    || !isRecord(value.firebase)
    || typeof value.firebase.apiKey !== 'string'
    || typeof value.firebase.authDomain !== 'string'
    || typeof value.firebase.projectId !== 'string'
    || typeof value.firebase.appId !== 'string'
    || typeof value.appCheckSiteKey !== 'string'
    || typeof value.functionsRegion !== 'string') {
    throw new Error('staff_firebase_config_missing');
  }

  const apiKey = value.firebase.apiKey.trim();
  const authDomain = value.firebase.authDomain.trim();
  const projectId = value.firebase.projectId.trim();
  const appId = value.firebase.appId.trim();
  const appCheckSiteKey = value.appCheckSiteKey.trim();
  const functionsRegion = value.functionsRegion.trim();

  if (apiKey === '' || appCheckSiteKey === '') {
    throw new Error('staff_firebase_config_missing');
  }
  if (!isDedicatedProjectId(projectId)
    || authDomain !== `${projectId}.firebaseapp.com`
    || !WEB_APP_ID_PATTERN.test(appId)
    || functionsRegion !== STAFF_FUNCTIONS_REGION) {
    throw new Error('staff_firebase_identity_invalid');
  }

  return Object.freeze({
    firebase: Object.freeze({ apiKey, authDomain, projectId, appId }),
    appCheckSiteKey,
    functionsRegion: STAFF_FUNCTIONS_REGION,
  });
}

export function resolveFunctionsOrigin(
  projectIdValue: string | undefined,
  regionValue: string | undefined,
): string {
  const projectId = projectIdValue?.trim() ?? '';
  const region = regionValue?.trim() ?? '';
  if (!isDedicatedProjectId(projectId) || region !== STAFF_FUNCTIONS_REGION) {
    return 'https://invalid.invalid';
  }
  return `https://${STAFF_FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`;
}

function isDedicatedProjectId(value: string): boolean {
  return DEDICATED_PROJECT_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
