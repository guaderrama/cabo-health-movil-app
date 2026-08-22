import type {
  CallableTransport,
  ServerStaffSession,
} from './staffGateway.js';

export type StaffAuditAction =
  | 'client_code.created'
  | 'client_code.revoked'
  | 'draft.created'
  | 'draft.updated'
  | 'draft.archived';

export interface StaffAuditEvent {
  readonly eventId: string;
  readonly action: StaffAuditAction;
  readonly actorLabel: 'Staff';
  readonly targetSuffix: string;
  readonly occurredAtMs: number;
  readonly outcome: 'success';
}

export interface AuditGateway {
  list(): Promise<readonly StaffAuditEvent[]>;
}

export interface AuditModel {
  getSnapshot(): Readonly<{ events: readonly StaffAuditEvent[] }>;
  load(): Promise<void>;
}

export function createAuditGateway(input: Readonly<{
  session: ServerStaffSession;
  transport: CallableTransport;
}>): AuditGateway {
  return Object.freeze({
    list: async () => {
      if (input.session.scope !== 'production'
        || !input.session.permissions.includes('client_resource_drafts')) {
        throw new Error('staff_capability_unavailable');
      }
      return parseAuditEvents(await input.transport('adminListAudit', {}));
    },
  });
}

const EVENT_FIELDS = Object.freeze([
  'action',
  'actorLabel',
  'eventId',
  'occurredAtMs',
  'outcome',
  'targetSuffix',
]);

export function parseAuditEvents(value: unknown): readonly StaffAuditEvent[] {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.events)) {
    throw new Error('audit_response_invalid');
  }
  return Object.freeze(value.events.map(parseAuditEvent));
}

export function createAuditModel(gateway: AuditGateway): AuditModel {
  let snapshot: Readonly<{ events: readonly StaffAuditEvent[] }> = Object.freeze({
    events: Object.freeze([]),
  });
  return Object.freeze({
    getSnapshot: () => snapshot,
    load: async () => {
      const events = await gateway.list();
      snapshot = Object.freeze({ events: Object.freeze([...events]) });
    },
  });
}

function parseAuditEvent(value: unknown): StaffAuditEvent {
  if (!hasExactKeys(value, EVENT_FIELDS)
    || typeof value.eventId !== 'string'
    || !isAuditAction(value.action)
    || value.actorLabel !== 'Staff'
    || typeof value.targetSuffix !== 'string'
    || !/^[A-Za-z0-9_-]{1,12}$/u.test(value.targetSuffix)
    || !Number.isSafeInteger(value.occurredAtMs)
    || value.outcome !== 'success') {
    throw new Error('audit_response_invalid');
  }
  return Object.freeze({
    eventId: value.eventId,
    action: value.action,
    actorLabel: value.actorLabel,
    targetSuffix: value.targetSuffix,
    occurredAtMs: value.occurredAtMs as number,
    outcome: value.outcome,
  });
}

function isAuditAction(value: unknown): value is StaffAuditAction {
  return value === 'client_code.created'
    || value === 'client_code.revoked'
    || value === 'draft.created'
    || value === 'draft.updated'
    || value === 'draft.archived';
}

function hasExactKeys(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && fields.every((field, index) => keys[index] === field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
