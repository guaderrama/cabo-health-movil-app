export interface BrokerCommandService {
  introspect(input: Readonly<{
    brokerRequestHash: string;
    sessionId: string;
  }>): Promise<Readonly<{
    active: true;
    csrfToken: string;
    entitlements: readonly string[];
    expiresAtMs: number;
  }>>;
  redeemLaunch(input: Readonly<{
    brokerRequestHash: string;
    nonce: string;
  }>): Promise<Readonly<{ expiresAtMs: number; sessionId: string }>>;
  revoke(input: Readonly<{
    brokerRequestHash: string;
    csrfToken: string;
    sessionId: string;
  }>): Promise<Readonly<{ revoked: true }>>;
}

export class BrokerApiInputError extends Error {
  constructor() {
    super('invalid_broker_request');
    this.name = 'BrokerApiInputError';
  }
}

export async function dispatchBrokerCommand(
  request: Readonly<{
    path: string;
    rawBody: Buffer;
    requestHash: string;
  }>,
  service: BrokerCommandService,
): Promise<Readonly<Record<string, unknown>>> {
  const body = parseJsonObject(request.rawBody);
  switch (request.path) {
    case '/v1/launch/redeem': {
      if (!hasExactStringFields(body, ['nonce'])) fail();
      return service.redeemLaunch(Object.freeze({
        brokerRequestHash: request.requestHash,
        nonce: body.nonce as string,
      }));
    }
    case '/v1/sessions/introspect': {
      if (!hasExactStringFields(body, ['sessionId'])) fail();
      return service.introspect(Object.freeze({
        brokerRequestHash: request.requestHash,
        sessionId: body.sessionId as string,
      }));
    }
    case '/v1/sessions/revoke': {
      if (!hasExactStringFields(body, ['csrfToken', 'sessionId'])) fail();
      return service.revoke(Object.freeze({
        brokerRequestHash: request.requestHash,
        csrfToken: body.csrfToken as string,
        sessionId: body.sessionId as string,
      }));
    }
    default:
      return fail();
  }
}

function parseJsonObject(rawBody: Buffer): Record<string, unknown> {
  try {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 4_096) fail();
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    if (!isRecord(parsed)) fail();
    return parsed;
  } catch (error) {
    if (error instanceof BrokerApiInputError) throw error;
    return fail();
  }
}

function hasExactStringFields(
  value: Record<string, unknown>,
  expectedFields: readonly string[],
): boolean {
  const actualFields = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return actualFields.length === expected.length
    && actualFields.every((field, index) => field === expected[index])
    && expected.every((field) => (
      typeof value[field] === 'string'
      && (value[field] as string).length > 0
      && (value[field] as string).length <= 1_024
    ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(): never {
  throw new BrokerApiInputError();
}
