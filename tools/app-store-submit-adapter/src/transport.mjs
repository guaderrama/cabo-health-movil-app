import { isDeepStrictEqual } from 'node:util';
import { API_ORIGIN, MAX_JSON_BYTES } from './constants.mjs';
import { createJwt } from './auth.mjs';
import { reject } from './errors.mjs';

const METHODS = new Set(['GET', 'POST', 'PATCH']);

function validateRequest(method, path, body) {
  if (!METHODS.has(method)
    || typeof path !== 'string' || !path.startsWith('/v1/')
    || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)
    || new URL(path, API_ORIGIN).origin !== API_ORIGIN
    || (method === 'GET' ? body !== undefined : (
      body === null || typeof body !== 'object' || Array.isArray(body)
    ))) reject('APP_STORE_CONNECT_REQUEST_INVALID');
}

function parseResponseBytes(bytes) {
  if (bytes.length <= 0 || bytes.length > MAX_JSON_BYTES) {
    reject('APP_STORE_CONNECT_RESPONSE_INVALID');
  }
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) reject('APP_STORE_CONNECT_RESPONSE_INVALID');
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      reject('APP_STORE_CONNECT_RESPONSE_INVALID');
    }
    return value;
  } catch (error) {
    if (error?.message === 'APP_STORE_CONNECT_RESPONSE_INVALID') throw error;
    reject('APP_STORE_CONNECT_RESPONSE_INVALID');
  }
}

async function readCappedResponseBytes(response) {
  const reader = response.body?.getReader?.();
  if (reader === undefined) reject('APP_STORE_CONNECT_RESPONSE_INVALID');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) reject('APP_STORE_CONNECT_RESPONSE_INVALID');
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel();
        reject('APP_STORE_CONNECT_RESPONSE_INVALID');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export class AppStoreConnectTransport {
  constructor(credentials, {
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    timeoutMs = 30_000,
  } = {}) {
    if (typeof fetchImpl !== 'function' || typeof now !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
      reject('APP_STORE_CONNECT_TRANSPORT_INVALID');
    }
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  async request({ method, path, body }) {
    validateRequest(method, path, body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${createJwt(this.credentials, { now: this.now() })}`,
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      response = await this.fetchImpl(`${API_ORIGIN}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      reject('APP_STORE_CONNECT_NETWORK_ERROR');
    }
    try {
      if (!Number.isInteger(response?.status)) reject('APP_STORE_CONNECT_RESPONSE_INVALID');
      if (response.status < 200 || response.status > 299) {
        try {
          await response.body?.cancel?.();
        } catch {
          // The public error remains the HTTP status. Response bytes are never
          // parsed or exposed, even if draining the body also fails.
        }
        reject(`APP_STORE_CONNECT_HTTP_${response.status}`);
      }
      const contentLength = response.headers?.get?.('content-length');
      if (contentLength !== null && contentLength !== undefined
        && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_JSON_BYTES)) {
        reject('APP_STORE_CONNECT_RESPONSE_INVALID');
      }
      const contentType = response.headers?.get?.('content-type');
      if (typeof contentType !== 'string' || !/^application\/(?:vnd\.api\+)?json(?:\s*;|$)/iu.test(contentType)) {
        reject('APP_STORE_CONNECT_RESPONSE_INVALID');
      }
      let bytes;
      try {
        bytes = await readCappedResponseBytes(response);
      } catch {
        reject('APP_STORE_CONNECT_RESPONSE_INVALID');
      }
      return Object.freeze({ status: response.status, body: parseResponseBytes(bytes) });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class FixtureTransport {
  constructor(expectations) {
    if (!Array.isArray(expectations)) reject('DRY_RUN_FIXTURE_INVALID');
    this.expectations = expectations.map((expectation) => structuredClone(expectation));
    this.requests = [];
  }

  async request({ method, path, body }) {
    validateRequest(method, path, body);
    const expectation = this.expectations.shift();
    if (expectation === undefined
      || expectation.method !== method || expectation.path !== path
      || !isDeepStrictEqual(expectation.body, body)
      || !Number.isInteger(expectation.status)
      || expectation.response === null || typeof expectation.response !== 'object'
      || Array.isArray(expectation.response)) reject('DRY_RUN_FIXTURE_MISMATCH');
    this.requests.push(structuredClone({ method, path, body }));
    if (expectation.status < 200 || expectation.status > 299) {
      reject(`APP_STORE_CONNECT_HTTP_${expectation.status}`);
    }
    return Object.freeze({
      status: expectation.status,
      body: structuredClone(expectation.response),
    });
  }

  assertConsumed() {
    if (this.expectations.length !== 0) reject('DRY_RUN_FIXTURE_NOT_CONSUMED');
  }
}
