import type { FirebaseOptions } from 'firebase/app';

export const STAFF_FUNCTIONS_REGION = 'us-central1' as const;
export const CLOSED_FUNCTIONS_ORIGIN = 'https://invalid.invalid' as const;

const DEDICATED_PROJECT_PATTERN = /^cabohealth-[a-z0-9](?:[a-z0-9-]{0,17}[a-z0-9])?$/u;
const WEB_APP_ID_PATTERN = /^1:[0-9]{6,20}:web:[0-9a-f]{8,64}$/u;

export type StaffAppEnvironment = 'staging' | 'production';

export interface StaffDeploymentIdentity {
  readonly appEnv: StaffAppEnvironment;
  readonly expectedProjectId: string;
  readonly expectedWebAppId: string;
  readonly backendStaffWebAppId: string;
}

export interface StaffFirebaseConfig {
  readonly firebase: FirebaseOptions;
  readonly appCheckSiteKey: string;
  readonly functionsRegion: typeof STAFF_FUNCTIONS_REGION;
  readonly deployment: StaffDeploymentIdentity;
}

export function validateStaffFirebaseConfig(value: unknown): StaffFirebaseConfig {
  if (!isRecord(value)
    || !isRecord(value.firebase)
    || !isRecord(value.deployment)
    || typeof value.firebase.apiKey !== 'string'
    || typeof value.firebase.authDomain !== 'string'
    || typeof value.firebase.projectId !== 'string'
    || typeof value.firebase.appId !== 'string'
    || typeof value.appCheckSiteKey !== 'string'
    || typeof value.functionsRegion !== 'string'
    || typeof value.deployment.appEnv !== 'string'
    || typeof value.deployment.expectedProjectId !== 'string'
    || typeof value.deployment.expectedWebAppId !== 'string'
    || typeof value.deployment.backendStaffWebAppId !== 'string') {
    throw new Error('staff_firebase_config_missing');
  }

  const apiKey = value.firebase.apiKey.trim();
  const authDomain = value.firebase.authDomain.trim();
  const projectId = value.firebase.projectId.trim();
  const appId = value.firebase.appId.trim();
  const appCheckSiteKey = value.appCheckSiteKey.trim();
  const functionsRegion = value.functionsRegion.trim();
  const appEnv = value.deployment.appEnv.trim();
  const expectedProjectId = value.deployment.expectedProjectId.trim();
  const expectedWebAppId = value.deployment.expectedWebAppId.trim();
  const backendStaffWebAppId = value.deployment.backendStaffWebAppId.trim();

  if (apiKey === '' || appCheckSiteKey === '' || expectedProjectId === ''
    || expectedWebAppId === '' || backendStaffWebAppId === '') {
    throw new Error('staff_firebase_config_missing');
  }
  if (!isStaffAppEnvironment(appEnv)
    || !isDedicatedProjectId(expectedProjectId)
    || !matchesEnvironment(expectedProjectId, appEnv)
    || projectId !== expectedProjectId
    || authDomain !== `${expectedProjectId}.firebaseapp.com`
    || !WEB_APP_ID_PATTERN.test(expectedWebAppId)
    || appId !== expectedWebAppId
    || backendStaffWebAppId !== expectedWebAppId
    || functionsRegion !== STAFF_FUNCTIONS_REGION) {
    throw new Error('staff_firebase_identity_invalid');
  }

  return Object.freeze({
    firebase: Object.freeze({ apiKey, authDomain, projectId, appId }),
    appCheckSiteKey,
    functionsRegion: STAFF_FUNCTIONS_REGION,
    deployment: Object.freeze({
      appEnv,
      expectedProjectId,
      expectedWebAppId,
      backendStaffWebAppId,
    }),
  });
}

export function resolveFunctionsOrigin(value: unknown): string {
  try {
    const config = validateStaffFirebaseConfig(value);
    return `https://${STAFF_FUNCTIONS_REGION}-${config.deployment.expectedProjectId}.cloudfunctions.net`;
  } catch {
    return CLOSED_FUNCTIONS_ORIGIN;
  }
}

function isStaffAppEnvironment(value: string): value is StaffAppEnvironment {
  return value === 'staging' || value === 'production';
}

function matchesEnvironment(projectId: string, appEnv: StaffAppEnvironment): boolean {
  return projectId.endsWith(appEnv === 'production' ? '-prod' : '-staging');
}

function isDedicatedProjectId(value: string): boolean {
  return DEDICATED_PROJECT_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
