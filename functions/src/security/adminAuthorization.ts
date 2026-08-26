const MAX_AUTH_AGE_MS = 15 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30 * 1_000;

const KNOWN_PERMISSIONS = Object.freeze([
  'client_codes',
  'client_resource_drafts',
  'client_resource_publish',
  'app_review_credential',
] as const);

export type ProductionAdminPermission = typeof KNOWN_PERMISSIONS[number];

interface ProductionStaffAuthorizationInput {
  readonly auth: Readonly<{ uid: string; token: Readonly<Record<string, unknown>> }> | undefined;
  readonly loadAdmin: (uid: string) => Promise<unknown | undefined>;
  readonly nowMs: number;
}

export async function authorizeProductionAdmin(input: {
  readonly auth: Readonly<{ uid: string; token: Readonly<Record<string, unknown>> }> | undefined;
  readonly loadAdmin: (uid: string) => Promise<unknown | undefined>;
  readonly nowMs: number;
  readonly requiredPermission: ProductionAdminPermission;
}): Promise<Readonly<{ uid: string }>> {
  const staff = await authorizeProductionStaff(input);
  if (!staff.permissions.includes(input.requiredPermission)) {
    throw new Error('admin_authorization_failed');
  }
  return Object.freeze({ uid: staff.uid });
}

export async function authorizeProductionStaff(
  input: Readonly<ProductionStaffAuthorizationInput>,
): Promise<Readonly<{
  permissions: readonly ProductionAdminPermission[];
  scope: 'production';
  uid: string;
}>> {
  const failure = () => new Error('admin_authorization_failed');
  const { auth } = input;
  if (!auth || !auth.uid || auth.token.catalogAdmin !== true) throw failure();
  const authTimeSeconds = auth.token.auth_time;
  if (!Number.isSafeInteger(authTimeSeconds)) throw failure();
  const authAgeMs = input.nowMs - (authTimeSeconds as number) * 1_000;
  if (authAgeMs < -MAX_CLOCK_SKEW_MS || authAgeMs > MAX_AUTH_AGE_MS) throw failure();
  if (auth.token.email_verified !== true) throw failure();
  if (!isRecord(auth.token.firebase)
    || auth.token.firebase.sign_in_provider !== 'password') throw failure();

  const admin = await input.loadAdmin(auth.uid);
  if (
    !isRecord(admin)
    || admin.schemaVersion !== 1
    || admin.active !== true
    || admin.scope !== 'production'
    || !Array.isArray(admin.permissions)
    || admin.permissions.length === 0
    || !admin.permissions.every((permission) => (
      typeof permission === 'string'
      && (KNOWN_PERMISSIONS as readonly string[]).includes(permission)
    ))
  ) throw failure();
  const permissionSet = new Set(admin.permissions as ProductionAdminPermission[]);
  const permissions = Object.freeze(
    KNOWN_PERMISSIONS.filter((permission) => permissionSet.has(permission)),
  );
  return Object.freeze({ permissions, scope: 'production' as const, uid: auth.uid });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
