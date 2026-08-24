import { FirebaseError, initializeApp } from 'firebase/app';
import {
  ProviderId,
  browserSessionPersistence,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check';
import { getFunctions, httpsCallable } from 'firebase/functions';

import {
  calculateStaffSessionExpiryMs,
  createAuthorizationBoundTransport,
} from '../domain/authBoundary.js';
import {
  createAppReviewCredentialGateway,
  type AppReviewCredentialGateway,
} from '../domain/appReviewCredential.js';
import {
  createAuditGateway,
  type AuditGateway,
} from '../domain/auditLog.js';
import {
  createCatalogDraftGateway,
  type CatalogDraftGateway,
} from '../domain/catalogDrafts.js';
import {
  createScopedStaffGateway,
  parseServerStaffSession,
  type CallableTransport,
  type ServerStaffSession,
  type StaffGateway,
} from '../domain/staffGateway.js';
import type { StaffFirebaseConfig } from './staffFirebaseConfig.js';

export type StaffSignInResult =
  | Readonly<{ kind: 'email-verification-required' }>
  | Readonly<{
    kind: 'authenticated';
    session: ServerStaffSession;
    gateway: StaffGateway;
    draftGateway: CatalogDraftGateway;
    auditGateway: AuditGateway;
    appReviewGateway: AppReviewCredentialGateway;
  }>;

export interface FirebaseStaffServices {
  signIn(email: string, password: string): Promise<StaffSignInResult>;
  requestPasswordReset(email: string): Promise<void>;
  restore(): Promise<Extract<StaffSignInResult, { kind: 'authenticated' }> | null>;
  signOut(): Promise<void>;
  onAuthorizationLost(listener: () => void): () => void;
}

export function createFirebaseStaffServices(config: StaffFirebaseConfig): FirebaseStaffServices {
  const app = initializeApp(config.firebase, 'cabohealth-staff-portal');
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  const auth = getAuth(app);
  const functions = getFunctions(app, config.functionsRegion);
  const rawProduction: CallableTransport = async (name, payload) => {
    const response = await httpsCallable<Record<string, unknown>, unknown>(functions, name, {
      limitedUseAppCheckTokens: true,
    })(payload);
    return response.data;
  };
  const review: CallableTransport = async () => {
    throw new Error('review_sandbox_backend_unavailable');
  };
  const authorizationLostListeners = new Set<() => void>();
  let authorizationInvalidation: Promise<void> | null = null;
  let sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSessionExpiryTimer = () => {
    if (sessionExpiryTimer !== null) clearTimeout(sessionExpiryTimer);
    sessionExpiryTimer = null;
  };

  const invalidateAuthorization = (): Promise<void> => {
    if (authorizationInvalidation) return authorizationInvalidation;
    clearSessionExpiryTimer();
    authorizationInvalidation = (async () => {
      try {
        await signOut(auth);
      } finally {
        for (const listener of authorizationLostListeners) {
          try { listener(); } catch { /* A view listener cannot reopen authorization. */ }
        }
      }
    })().finally(() => { authorizationInvalidation = null; });
    return authorizationInvalidation;
  };
  const production = createAuthorizationBoundTransport(rawProduction, invalidateAuthorization);

  const armSessionExpiry = async (expiresAtMs: number) => {
    clearSessionExpiryTimer();
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      await invalidateAuthorization();
      throw authorizationExpiredError();
    }
    sessionExpiryTimer = setTimeout(() => {
      void invalidateAuthorization().catch(() => undefined);
    }, remainingMs);
  };

  const finishAuthenticated = async (user: User): Promise<Extract<StaffSignInResult, { kind: 'authenticated' }>> => {
    const expiresAtMs = await assertVerifiedPasswordSession(user);
    const rawSession = await production('adminGetStaffSession', {});
    const session = parseServerStaffSession(rawSession);
    await armSessionExpiry(expiresAtMs);
    return Object.freeze({
      kind: 'authenticated',
      session,
      gateway: createScopedStaffGateway({ production, review, session }),
      draftGateway: createCatalogDraftGateway({ session, transport: production }),
      auditGateway: createAuditGateway({ session, transport: production }),
      appReviewGateway: createAppReviewCredentialGateway({ session, transport: production }),
    });
  };

  return Object.freeze({
    signIn: async (email: string, password: string) => {
      clearSessionExpiryTimer();
      await setPersistence(auth, browserSessionPersistence);
      try {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
          await signOut(auth);
          return Object.freeze({ kind: 'email-verification-required' });
        }
        return await finishAuthenticated(credential.user);
      } catch (error) {
        await signOut(auth);
        throw error;
      }
    },
    requestPasswordReset: async (email: string) => {
      try {
        await sendPasswordResetEmail(auth, email.trim(), {
          url: 'https://cabohealth.org/staff/',
        });
      } catch (error) {
        if (!(error instanceof FirebaseError && error.code === 'auth/user-not-found')) throw error;
      }
    },
    restore: async () => {
      await auth.authStateReady();
      if (!auth.currentUser) return null;
      try {
        return await finishAuthenticated(auth.currentUser);
      } catch {
        await signOut(auth);
        return null;
      }
    },
    signOut: async () => {
      clearSessionExpiryTimer();
      await signOut(auth);
    },
    onAuthorizationLost: (listener: () => void) => {
      authorizationLostListeners.add(listener);
      return () => { authorizationLostListeners.delete(listener); };
    },
  });
}

async function assertVerifiedPasswordSession(user: User): Promise<number> {
  const token = await user.getIdTokenResult();
  if (!user.emailVerified || token.signInProvider !== ProviderId.PASSWORD) {
    throw new Error('verified_password_required');
  }
  return calculateStaffSessionExpiryMs(Date.parse(token.authTime) / 1000);
}

function authorizationExpiredError(): Error & { code: string } {
  return Object.assign(new Error('staff_session_expired'), { code: 'auth/requires-recent-login' });
}
