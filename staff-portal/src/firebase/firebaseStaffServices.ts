import { FirebaseError, initializeApp } from 'firebase/app';
import {
  FactorId,
  TotpMultiFactorGenerator,
  browserSessionPersistence,
  getAuth,
  getMultiFactorResolver,
  multiFactor,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type MultiFactorError,
  type MultiFactorResolver,
  type User,
} from 'firebase/auth';
import {
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'firebase/app-check';
import { getFunctions, httpsCallable } from 'firebase/functions';

import {
  createScopedStaffGateway,
  parseServerStaffSession,
  type CallableTransport,
  type ServerStaffSession,
  type StaffGateway,
} from '../domain/staffGateway.js';
import type { StaffFirebaseConfig } from './staffFirebaseConfig.js';

export type StaffSignInResult =
  | Readonly<{ kind: 'mfa-required'; enrollmentId: string; displayName: string }>
  | Readonly<{ kind: 'authenticated'; session: ServerStaffSession; gateway: StaffGateway }>;

export interface FirebaseStaffServices {
  signIn(email: string, password: string): Promise<StaffSignInResult>;
  completeTotp(oneTimePassword: string): Promise<Extract<StaffSignInResult, { kind: 'authenticated' }>>;
  restore(): Promise<Extract<StaffSignInResult, { kind: 'authenticated' }> | null>;
  signOut(): Promise<void>;
}

export function createFirebaseStaffServices(config: StaffFirebaseConfig): FirebaseStaffServices {
  const app = initializeApp(config.firebase, 'cabohealth-staff-portal');
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  const auth = getAuth(app);
  const functions = getFunctions(app, config.functionsRegion);
  const production: CallableTransport = async (name, payload) => {
    const response = await httpsCallable<Record<string, unknown>, unknown>(functions, name, {
      limitedUseAppCheckTokens: true,
    })(payload);
    return response.data;
  };
  const review: CallableTransport = async () => {
    throw new Error('review_sandbox_backend_unavailable');
  };
  let pendingResolver: MultiFactorResolver | null = null;
  let pendingEnrollmentId: string | null = null;

  const finishAuthenticated = async (user: User): Promise<Extract<StaffSignInResult, { kind: 'authenticated' }>> => {
    await assertTotpMfaSession(user);
    const rawSession = await production('adminGetStaffSession', {});
    const session = parseServerStaffSession(rawSession);
    return Object.freeze({
      kind: 'authenticated',
      session,
      gateway: createScopedStaffGateway({ production, review, session }),
    });
  };

  return Object.freeze({
    signIn: async (email: string, password: string) => {
      await setPersistence(auth, browserSessionPersistence);
      pendingResolver = null;
      pendingEnrollmentId = null;
      try {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        return await finishAuthenticated(credential.user);
      } catch (error) {
        if (!isMfaRequired(error)) {
          await signOut(auth);
          throw error;
        }
        const resolver = getMultiFactorResolver(auth, error as MultiFactorError);
        const hint = resolver.hints.find((candidate) => candidate.factorId === FactorId.TOTP);
        if (!hint) throw new Error('totp_factor_required');
        pendingResolver = resolver;
        pendingEnrollmentId = hint.uid;
        return Object.freeze({
          kind: 'mfa-required',
          enrollmentId: hint.uid,
          displayName: hint.displayName?.trim() || 'Authenticator',
        });
      }
    },
    completeTotp: async (oneTimePassword: string) => {
      if (!pendingResolver || !pendingEnrollmentId) throw new Error('mfa_challenge_missing');
      const resolver = pendingResolver;
      const enrollmentId = pendingEnrollmentId;
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(
        enrollmentId,
        oneTimePassword.trim(),
      );
      const credential = await resolver.resolveSignIn(assertion);
      pendingResolver = null;
      pendingEnrollmentId = null;
      try {
        return await finishAuthenticated(credential.user);
      } catch (error) {
        await signOut(auth);
        throw error;
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
    signOut: () => signOut(auth),
  });
}

async function assertTotpMfaSession(user: User): Promise<void> {
  const enrolled = multiFactor(user).enrolledFactors.some((factor) => factor.factorId === FactorId.TOTP);
  const token = await user.getIdTokenResult(true);
  const firebaseClaim = token.claims.firebase;
  const secondFactor = isRecord(firebaseClaim) ? firebaseClaim.sign_in_second_factor : undefined;
  if (!enrolled || secondFactor !== FactorId.TOTP) {
    throw new Error('totp_mfa_required');
  }
}

function isMfaRequired(error: unknown): boolean {
  return error instanceof FirebaseError && error.code === 'auth/multi-factor-auth-required';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
