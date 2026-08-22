import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BrokerApiInputError,
  dispatchBrokerCommand,
  type BrokerCommandService,
} from '../../domain/brokerApi.js';

const requestHash = 'broker_request_hash_000000000000000001';

test('broker API dispatches only the three exact JSON contracts', async () => {
  const calls: unknown[] = [];
  const service: BrokerCommandService = {
    async introspect(input) {
      calls.push(input);
      return {
        active: true, csrfToken: 'csrf', entitlements: ['resource'], expiresAtMs: 123,
      };
    },
    async redeemLaunch(input) {
      calls.push(input);
      return { expiresAtMs: 123, sessionId: 'session' };
    },
    async revoke(input) {
      calls.push(input);
      return { revoked: true };
    },
  };

  assert.deepEqual(await dispatchBrokerCommand({
    path: '/v1/launch/redeem', rawBody: json({ nonce: 'nonce' }), requestHash,
  }, service), { expiresAtMs: 123, sessionId: 'session' });
  assert.deepEqual(await dispatchBrokerCommand({
    path: '/v1/sessions/introspect', rawBody: json({ sessionId: 'session' }), requestHash,
  }, service), {
    active: true, csrfToken: 'csrf', entitlements: ['resource'], expiresAtMs: 123,
  });
  assert.deepEqual(await dispatchBrokerCommand({
    path: '/v1/sessions/revoke',
    rawBody: json({ csrfToken: 'csrf', sessionId: 'session' }),
    requestHash,
  }, service), { revoked: true });

  assert.deepEqual(calls, [
    { brokerRequestHash: requestHash, nonce: 'nonce' },
    { brokerRequestHash: requestHash, sessionId: 'session' },
    { brokerRequestHash: requestHash, csrfToken: 'csrf', sessionId: 'session' },
  ]);
});

test('broker API rejects malformed JSON, extra fields, and near-match paths', async () => {
  const unused: BrokerCommandService = {
    async introspect() { throw new Error('should_not_run'); },
    async redeemLaunch() { throw new Error('should_not_run'); },
    async revoke() { throw new Error('should_not_run'); },
  };
  const invalid = [
    { path: '/v1/launch/redeem', rawBody: Buffer.from('{') },
    { path: '/v1/launch/redeem', rawBody: json({ nonce: 'nonce', url: 'https://example.test' }) },
    { path: '/v1/sessions/introspect', rawBody: json({ sessionId: 42 }) },
    { path: '/v1/sessions/revoke', rawBody: json({ csrfToken: 'csrf' }) },
    { path: '/v1/sessions/revoke/', rawBody: json({ csrfToken: 'csrf', sessionId: 'session' }) },
  ];

  for (const input of invalid) {
    await assert.rejects(
      dispatchBrokerCommand({ ...input, requestHash }, unused),
      (error: unknown) => error instanceof BrokerApiInputError,
    );
  }
});

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}
