import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import type { FirebaseBootstrapAdminBoundary } from '../domain/firebaseActivationBootstrap.js';
import { AdminFirebaseBootstrapBoundary } from './adminFirebaseBootstrapBoundary.js';
import { AdminFirestoreDocumentDatabase } from './adminFirestoreDocumentDatabase.js';

export function assertFirebaseBootstrapAdminEnvironment(
  projectId: string,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (environment.FIRESTORE_EMULATOR_HOST || environment.FIREBASE_AUTH_EMULATOR_HOST) {
    throw invalidEnvironment();
  }
  for (const variable of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'] as const) {
    const ambientProject = environment[variable];
    if (ambientProject && ambientProject !== projectId) throw invalidEnvironment();
  }
  const firebaseConfig = environment.FIREBASE_CONFIG;
  if (firebaseConfig) {
    try {
      const parsed = JSON.parse(firebaseConfig) as unknown;
      if (!isRecord(parsed) || parsed.projectId !== projectId) throw invalidEnvironment();
    } catch {
      throw invalidEnvironment();
    }
  }
}

export async function createFirebaseBootstrapAdminBoundary(
  projectId: string,
): Promise<FirebaseBootstrapAdminBoundary> {
  assertFirebaseBootstrapAdminEnvironment(projectId, process.env);
  const appName = `cabohealth-bootstrap-${projectId}`;
  const app = getApps().find((candidate) => candidate.name === appName)
    ?? initializeApp({ projectId }, appName);
  const auth = getAuth(app);
  return new AdminFirebaseBootstrapBoundary({
    auth: {
      getUser: async (uid) => {
        try {
          const user = await auth.getUser(uid);
          return Object.freeze({
            customClaims: Object.freeze({ ...(user.customClaims ?? {}) }),
            disabled: user.disabled,
            emailVerified: user.emailVerified,
            factorCount: user.multiFactor?.enrolledFactors.length ?? 0,
            providerIds: Object.freeze(user.providerData.map((provider) => provider.providerId)),
          });
        } catch (error) {
          if (isRecord(error) && error.code === 'auth/user-not-found') return undefined;
          throw error;
        }
      },
      setCustomClaims: async (uid, claims) => {
        await auth.setCustomUserClaims(uid, claims);
      },
    },
    database: new AdminFirestoreDocumentDatabase(getFirestore(app)),
    projectId,
  });
}

function invalidEnvironment(): Error {
  return new Error('firebase_bootstrap_admin_environment_invalid');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
