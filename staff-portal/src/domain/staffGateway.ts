export type StaffScope = 'production' | 'review-sandbox';
export type StaffPermission = 'client_codes' | 'client_resource_drafts';
export type ClientCodeSlot = 1 | 2 | 3 | 4;

// Release-reviewed entitlement. Keep this fixed until a server-authoritative
// resource-list callable exists; the browser must never accept arbitrary IDs.
export const REVIEWED_CLIENT_RESOURCE_IDS = Object.freeze(['client-resources'] as const);

export interface ClientCodeSummary {
  readonly codeId: string;
  readonly slot: ClientCodeSlot;
  readonly displaySuffix: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly status: 'active' | 'revoked';
}

export interface CreateClientCodeInput {
  readonly slot: ClientCodeSlot;
  readonly expiresAtMs: number;
  readonly resourceIds: readonly string[];
}

export interface CreatedClientCode {
  readonly oneTimeCode: string;
  readonly summary: Readonly<{
    codeId: string;
    displaySuffix: string;
    expiresAtMs: number;
    resourceIds: readonly string[];
    status: 'active';
  }>;
}

export interface ServerStaffSession {
  readonly scope: StaffScope;
  readonly permissions: readonly StaffPermission[];
}

export type CallableTransport = (
  name: string,
  payload: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export interface StaffGateway {
  readonly scope: StaffScope;
  listCodes(): Promise<readonly ClientCodeSummary[]>;
  createCode(input: CreateClientCodeInput): Promise<CreatedClientCode>;
  revokeCode(codeId: string): Promise<void>;
}

export function parseServerStaffSession(value: unknown): ServerStaffSession {
  if (!hasExactKeys(value, ['permissions', 'scope'])) {
    throw new Error('staff_session_untrusted');
  }
  if (value.scope !== 'production' && value.scope !== 'review-sandbox') {
    throw new Error('staff_scope_invalid');
  }
  if (!Array.isArray(value.permissions) || !value.permissions.every(isPermission)) {
    throw new Error('staff_permissions_invalid');
  }
  return Object.freeze({
    scope: value.scope,
    permissions: Object.freeze([...value.permissions]),
  });
}

export function createScopedStaffGateway(input: Readonly<{
  production: CallableTransport;
  review: CallableTransport;
  session: ServerStaffSession;
}>): StaffGateway {
  const isReview = input.session.scope === 'review-sandbox';
  const transport = isReview ? input.review : input.production;
  const listCodesName = isReview
    ? 'reviewSandboxListClientAccessCodes'
    : 'adminListClientAccessCodes';
  const createCodeName = isReview
    ? 'reviewSandboxCreateClientAccessCode'
    : 'adminCreateClientAccessCode';
  const revokeCodeName = isReview
    ? 'reviewSandboxRevokeClientAccessCode'
    : 'adminRevokeClientAccessCode';

  return Object.freeze({
    scope: input.session.scope,
    listCodes: async () => parseCodeList(await transport(listCodesName, {})),
    createCode: async (request: CreateClientCodeInput) => parseCreatedCode(await transport(createCodeName, {
      slot: request.slot,
      expiresAtMs: request.expiresAtMs,
      resourceIds: [...request.resourceIds],
    })),
    revokeCode: async (codeId: string) => {
      const result = await transport(revokeCodeName, { codeId });
      if (!isRecord(result) || result.revoked !== true) {
        throw new Error('staff_response_invalid');
      }
    },
  });
}

function parseCodeList(value: unknown): readonly ClientCodeSummary[] {
  if (!isRecord(value) || !Array.isArray(value.codes)) {
    throw new Error('staff_response_invalid');
  }
  return Object.freeze(value.codes.map(parseCodeSummary));
}

function parseCodeSummary(value: unknown): ClientCodeSummary {
  if (!isRecord(value)
    || typeof value.codeId !== 'string'
    || !isSlot(value.slot)
    || typeof value.displaySuffix !== 'string'
    || typeof value.createdAtMs !== 'number'
    || typeof value.expiresAtMs !== 'number'
    || (value.status !== 'active' && value.status !== 'revoked')) {
    throw new Error('staff_response_invalid');
  }
  return Object.freeze({
    codeId: value.codeId,
    slot: value.slot,
    displaySuffix: value.displaySuffix,
    createdAtMs: value.createdAtMs,
    expiresAtMs: value.expiresAtMs,
    status: value.status,
  });
}

function parseCreatedCode(value: unknown): CreatedClientCode {
  if (!isRecord(value)
    || typeof value.oneTimeCode !== 'string'
    || !isRecord(value.summary)
    || typeof value.summary.codeId !== 'string'
    || typeof value.summary.displaySuffix !== 'string'
    || typeof value.summary.expiresAtMs !== 'number'
    || !Array.isArray(value.summary.resourceIds)
    || !value.summary.resourceIds.every((id) => typeof id === 'string')
    || value.summary.status !== 'active') {
    throw new Error('staff_response_invalid');
  }
  return Object.freeze({
    oneTimeCode: value.oneTimeCode,
    summary: Object.freeze({
      codeId: value.summary.codeId,
      displaySuffix: value.summary.displaySuffix,
      expiresAtMs: value.summary.expiresAtMs,
      resourceIds: Object.freeze([...value.summary.resourceIds]),
      status: 'active',
    }),
  });
}

function isSlot(value: unknown): value is ClientCodeSlot {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isPermission(value: unknown): value is StaffPermission {
  return value === 'client_codes' || value === 'client_resource_drafts';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && fields.every((field, index) => keys[index] === field);
}
