import type {
  CallableTransport,
  ServerStaffSession,
} from './staffGateway.js';

export interface AppReviewCredentialStatus {
  readonly configured: boolean;
  readonly generation: number | null;
  readonly purpose: 'app_review';
  readonly rotatedAtMs: number | null;
}

export interface RotatedAppReviewCredential {
  readonly generation: number;
  readonly oneTimeCredential: string;
  readonly purpose: 'app_review';
  readonly rotatedAtMs: number;
}

export interface AppReviewCredentialGateway {
  status(): Promise<AppReviewCredentialStatus>;
  rotate(expectedGeneration: number | null): Promise<RotatedAppReviewCredential>;
}

export interface AppReviewCredentialSnapshot {
  readonly status: AppReviewCredentialStatus | null;
  readonly oneTimeCredential: string | null;
  readonly copied: boolean;
}

export interface AppReviewCredentialModel {
  getSnapshot(): AppReviewCredentialSnapshot;
  load(): Promise<void>;
  rotate(): Promise<void>;
  markCopied(): void;
  acknowledgeHidden(): void;
}

export function createAppReviewCredentialGateway(input: Readonly<{
  session: ServerStaffSession;
  transport: CallableTransport;
}>): AppReviewCredentialGateway {
  const assertAllowed = () => {
    if (input.session.scope !== 'production'
      || !input.session.permissions.includes('app_review_credential')) {
      throw new Error('staff_capability_unavailable');
    }
  };
  return Object.freeze({
    status: async () => {
      assertAllowed();
      return parseAppReviewCredentialStatus(
        await input.transport('adminGetAppReviewCredentialStatus', {}),
      );
    },
    rotate: async (expectedGeneration: number | null) => {
      assertAllowed();
      if (!(expectedGeneration === null || (
        Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 1
      ))) throw new Error('app_review_generation_invalid');
      return parseRotatedAppReviewCredential(
        await input.transport('adminRotateAppReviewCredential', { expectedGeneration }),
      );
    },
  });
}

export function createAppReviewCredentialModel(
  gateway: AppReviewCredentialGateway,
): AppReviewCredentialModel {
  let rotationInFlight = false;
  let snapshot: AppReviewCredentialSnapshot = freezeSnapshot({
    status: null,
    oneTimeCredential: null,
    copied: false,
  });
  return Object.freeze({
    getSnapshot: () => snapshot,
    load: async () => {
      const status = await gateway.status();
      snapshot = freezeSnapshot({ ...snapshot, status });
    },
    rotate: async () => {
      if (snapshot.oneTimeCredential !== null) {
        throw new Error('app_review_credential_pending_acknowledgment');
      }
      if (rotationInFlight) throw new Error('app_review_rotation_in_progress');
      if (snapshot.status === null) throw new Error('app_review_status_required');
      rotationInFlight = true;
      try {
        const rotated = await gateway.rotate(snapshot.status.generation);
        snapshot = freezeSnapshot({
          copied: false,
          oneTimeCredential: rotated.oneTimeCredential,
          status: Object.freeze({
            configured: true,
            generation: rotated.generation,
            purpose: 'app_review',
            rotatedAtMs: rotated.rotatedAtMs,
          }),
        });
      } finally {
        rotationInFlight = false;
      }
    },
    markCopied: () => {
      if (snapshot.oneTimeCredential === null) throw new Error('app_review_credential_missing');
      snapshot = freezeSnapshot({ ...snapshot, copied: true });
    },
    acknowledgeHidden: () => {
      if (snapshot.oneTimeCredential === null) throw new Error('app_review_credential_missing');
      if (!snapshot.copied) throw new Error('app_review_copy_required');
      snapshot = freezeSnapshot({
        ...snapshot,
        copied: false,
        oneTimeCredential: null,
      });
    },
  });
}

export function parseAppReviewCredentialStatus(value: unknown): AppReviewCredentialStatus {
  if (!hasExactKeys(value, ['configured', 'generation', 'purpose', 'rotatedAtMs'])
    || typeof value.configured !== 'boolean'
    || value.purpose !== 'app_review'
    || !isNullableGeneration(value.generation)
    || !isNullableServerTime(value.rotatedAtMs)
    || (value.configured && (value.generation === null || value.rotatedAtMs === null))
    || (!value.configured && (value.generation !== null || value.rotatedAtMs !== null))) {
    throw new Error('app_review_response_invalid');
  }
  return Object.freeze({
    configured: value.configured,
    generation: value.generation,
    purpose: 'app_review',
    rotatedAtMs: value.rotatedAtMs,
  });
}

export function parseRotatedAppReviewCredential(value: unknown): RotatedAppReviewCredential {
  if (!hasExactKeys(value, ['generation', 'oneTimeCredential', 'purpose', 'rotatedAtMs'])
    || !isGeneration(value.generation)
    || typeof value.oneTimeCredential !== 'string'
    || !/^AR-[0-9A-F]{8}(?:-[0-9A-F]{8}){3}$/u.test(value.oneTimeCredential)
    || value.purpose !== 'app_review'
    || !isServerTime(value.rotatedAtMs)) {
    throw new Error('app_review_response_invalid');
  }
  return Object.freeze({
    generation: value.generation,
    oneTimeCredential: value.oneTimeCredential,
    purpose: 'app_review',
    rotatedAtMs: value.rotatedAtMs,
  });
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isNullableGeneration(value: unknown): value is number | null {
  return value === null || isGeneration(value);
}

function isServerTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullableServerTime(value: unknown): value is number | null {
  return value === null || isServerTime(value);
}

function hasExactKeys(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && fields.every((field, index) => keys[index] === field);
}

function freezeSnapshot(value: AppReviewCredentialSnapshot): AppReviewCredentialSnapshot {
  return Object.freeze(value);
}
