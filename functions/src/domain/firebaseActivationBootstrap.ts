import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const OWNER_PERMISSIONS = Object.freeze([
  'client_codes',
  'client_resource_drafts',
  'app_review_credential',
] as const);

const CLIENT_RESOURCE_VALUE = Object.freeze({
  access: 'client' as const,
  iconKey: 'featured',
  id: 'client-resources',
  schemaVersion: 1 as const,
  status: 'active' as const,
  summary: Object.freeze({
    en: 'Complimentary educational resources for eligible existing CaboHealth clients.',
    es: 'Recursos educativos incluidos para clientes actuales elegibles de CaboHealth.',
  }),
  title: Object.freeze({
    en: 'Client Resources',
    es: 'Recursos para clientes',
  }),
});

export type FirebaseActivationEnvironment = 'production' | 'staging';

export interface FirebaseBootstrapPlan {
  readonly artifactKind: 'cabohealth-firebase-bootstrap-plan';
  readonly schemaVersion: 1;
  readonly environment: FirebaseActivationEnvironment;
  readonly projectId: string;
  readonly reviewDatabaseId: string;
  readonly owner: Readonly<{
    uid: string;
    requiredFactorId: 'totp';
    customClaims: Readonly<{ catalogAdmin: true }>;
    adminDocument: Readonly<{
      path: string;
      value: Readonly<{
        active: true;
        permissions: readonly typeof OWNER_PERMISSIONS[number][];
        schemaVersion: 1;
        scope: 'production';
      }>;
    }>;
  }>;
  readonly clientResourceDocument: Readonly<{
    path: '_private_client_resources/client-resources';
    value: typeof CLIENT_RESOURCE_VALUE;
  }>;
}

type FirebaseBootstrapDocument = FirebaseBootstrapPlan['owner']['adminDocument']
  | FirebaseBootstrapPlan['clientResourceDocument'];

export interface FirebaseBootstrapAdminBoundary {
  readonly projectId: string;
  loadOwner(uid: string): Promise<Readonly<{
    customClaims: Readonly<Record<string, unknown>>;
    disabled: boolean;
    factorIds: readonly string[];
  }> | undefined>;
  ensureDocumentsExact(documents: readonly FirebaseBootstrapDocument[]): Promise<void>;
  setCustomClaims(uid: string, claims: Readonly<Record<string, unknown>>): Promise<void>;
}

export function createFirebaseBootstrapPlan(input: Readonly<{
  environment: FirebaseActivationEnvironment;
  ownerUid: string;
  projectId: string;
  reviewDatabaseId: string;
}>): FirebaseBootstrapPlan {
  assertBootstrapIdentity(input);
  return Object.freeze({
    artifactKind: 'cabohealth-firebase-bootstrap-plan' as const,
    schemaVersion: 1 as const,
    environment: input.environment,
    projectId: input.projectId,
    reviewDatabaseId: input.reviewDatabaseId,
    owner: Object.freeze({
      uid: input.ownerUid,
      requiredFactorId: 'totp' as const,
      customClaims: Object.freeze({ catalogAdmin: true as const }),
      adminDocument: Object.freeze({
        path: `_private_admins/${input.ownerUid}`,
        value: Object.freeze({
          active: true as const,
          permissions: OWNER_PERMISSIONS,
          schemaVersion: 1 as const,
          scope: 'production' as const,
        }),
      }),
    }),
    clientResourceDocument: Object.freeze({
      path: '_private_client_resources/client-resources' as const,
      value: CLIENT_RESOURCE_VALUE,
    }),
  });
}

export function parseFirebaseBootstrapPlan(value: unknown): FirebaseBootstrapPlan {
  if (
    !isRecord(value)
    || (value.environment !== 'production' && value.environment !== 'staging')
    || typeof value.projectId !== 'string'
    || typeof value.reviewDatabaseId !== 'string'
    || !isRecord(value.owner)
    || typeof value.owner.uid !== 'string'
  ) throw new Error('firebase_bootstrap_plan_invalid');

  const expected = createFirebaseBootstrapPlan({
    environment: value.environment,
    ownerUid: value.owner.uid,
    projectId: value.projectId,
    reviewDatabaseId: value.reviewDatabaseId,
  });
  if (!isDeepStrictEqual(value, expected)) {
    throw new Error('firebase_bootstrap_plan_invalid');
  }
  return expected;
}

export function hashFirebaseBootstrapPlan(plan: FirebaseBootstrapPlan): string {
  return createHash('sha256').update(canonicalJson(plan), 'utf8').digest('hex');
}

export async function applyFirebaseBootstrapPlan(input: Readonly<{
  apply: boolean;
  boundary: (projectId: string) => Promise<FirebaseBootstrapAdminBoundary>;
  expectedEnvironment: FirebaseActivationEnvironment;
  expectedProjectId: string;
  expectedReviewDatabaseId: string;
  plan: FirebaseBootstrapPlan;
  reviewedPlanSha256: string | undefined;
}>): Promise<ReturnType<typeof sanitizeFirebaseBootstrapEvidence>> {
  const plan = parseFirebaseBootstrapPlan(input.plan);
  if (!input.apply) return sanitizeFirebaseBootstrapEvidence(plan, 'dry-run');

  if (
    input.reviewedPlanSha256 !== hashFirebaseBootstrapPlan(plan)
    || input.expectedEnvironment !== plan.environment
    || input.expectedProjectId !== plan.projectId
    || input.expectedReviewDatabaseId !== plan.reviewDatabaseId
  ) throw new Error('firebase_bootstrap_apply_not_authorized');

  const boundary = await input.boundary(plan.projectId);
  if (boundary.projectId !== plan.projectId) {
    throw new Error('firebase_bootstrap_apply_not_authorized');
  }
  const owner = await boundary.loadOwner(plan.owner.uid);
  if (
    !owner
    || owner.disabled
    || !owner.factorIds.includes(plan.owner.requiredFactorId)
    || !isRecord(owner.customClaims)
  ) throw new Error('firebase_bootstrap_owner_not_ready');

  await boundary.ensureDocumentsExact([
    plan.owner.adminDocument,
    plan.clientResourceDocument,
  ]);
  if (owner.customClaims.catalogAdmin !== true) {
    await boundary.setCustomClaims(plan.owner.uid, Object.freeze({
      ...owner.customClaims,
      catalogAdmin: true,
    }));
  }
  return sanitizeFirebaseBootstrapEvidence(plan, 'applied');
}

export function sanitizeFirebaseBootstrapEvidence(
  plan: FirebaseBootstrapPlan,
  status: 'applied' | 'dry-run',
): Readonly<{
  artifactKind: 'cabohealth-firebase-bootstrap-evidence';
  schemaVersion: 1;
  status: 'applied' | 'dry-run';
  environment: FirebaseActivationEnvironment;
  projectId: string;
  reviewDatabaseId: string;
  planSha256: string;
  containsSensitiveValues: false;
  operations: readonly string[];
}> {
  return Object.freeze({
    artifactKind: 'cabohealth-firebase-bootstrap-evidence' as const,
    schemaVersion: 1 as const,
    status,
    environment: plan.environment,
    projectId: plan.projectId,
    reviewDatabaseId: plan.reviewDatabaseId,
    planSha256: hashFirebaseBootstrapPlan(plan),
    containsSensitiveValues: false as const,
    operations: Object.freeze([
      'verify-owner-enabled-and-totp',
      'ensure-production-admin-document',
      'ensure-client-resources-document',
      'ensure-catalogAdmin-claim',
    ]),
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertBootstrapIdentity(input: Readonly<{
  environment: FirebaseActivationEnvironment;
  ownerUid: string;
  projectId: string;
  reviewDatabaseId: string;
}>): void {
  const projectSuffix = input.environment === 'production' ? 'prod' : 'staging';
  const projectPattern = new RegExp(`^cabohealth-(?:[a-z0-9]+-)*${projectSuffix}$`, 'u');
  const databaseSuffixPattern = input.environment === 'production'
    ? /-(?:prod|production)$/u
    : /-staging$/u;
  if (
    !projectPattern.test(input.projectId)
    || !/^cabohealth-review-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u.test(input.reviewDatabaseId)
    || !databaseSuffixPattern.test(input.reviewDatabaseId)
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(input.ownerUid)
  ) throw new Error('firebase_bootstrap_plan_invalid');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
