import { createPrivateKey, sign } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { readBoundFile } from './files.mjs';
import { reject } from './errors.mjs';

export const CREDENTIAL_ENVIRONMENT_KEYS = Object.freeze({
  keyKind: 'APP_STORE_CONNECT_KEY_KIND',
  keyId: 'APP_STORE_CONNECT_KEY_ID',
  issuerId: 'APP_STORE_CONNECT_ISSUER_ID',
  privateKeyPath: 'APP_STORE_CONNECT_PRIVATE_KEY_PATH',
});

const RAW_SECRET_ENVIRONMENT_KEYS = Object.freeze([
  'APP_STORE_CONNECT_PRIVATE_KEY',
  'ASC_PRIVATE_KEY',
  'EXPO_ASC_KEY_P8',
  'EXPO_ASC_KEY',
]);

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

export function loadCredentials(environment = process.env) {
  if (RAW_SECRET_ENVIRONMENT_KEYS.some((name) => environment[name] !== undefined)) {
    reject('RAW_PRIVATE_KEY_ENVIRONMENT_FORBIDDEN');
  }
  const keyKind = environment[CREDENTIAL_ENVIRONMENT_KEYS.keyKind];
  const keyId = environment[CREDENTIAL_ENVIRONMENT_KEYS.keyId];
  const issuerId = environment[CREDENTIAL_ENVIRONMENT_KEYS.issuerId];
  const privateKeyPath = environment[CREDENTIAL_ENVIRONMENT_KEYS.privateKeyPath];
  if (!['team', 'individual'].includes(keyKind)
    || typeof keyId !== 'string' || !/^[A-Z0-9]{10}$/u.test(keyId)
    || (keyKind === 'team' && (
      typeof issuerId !== 'string'
      || !/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/u.test(issuerId)
    ))
    || (keyKind === 'individual' && issuerId !== undefined)
    || typeof privateKeyPath !== 'string' || !isAbsolute(privateKeyPath)
    || resolve(privateKeyPath) !== privateKeyPath) {
    reject('APP_STORE_CONNECT_CREDENTIALS_INVALID');
  }
  const keyBytes = readBoundFile(privateKeyPath, {
    privateFile: true,
    maxBytes: 64 * 1024,
    code: 'APP_STORE_CONNECT_PRIVATE_KEY_FILE_INVALID',
  });
  let privateKey;
  try {
    const keyText = keyBytes.toString('utf8');
    if (!Buffer.from(keyText, 'utf8').equals(keyBytes)
      || !keyText.includes('-----BEGIN PRIVATE KEY-----')
      || !keyText.includes('-----END PRIVATE KEY-----')) {
      reject('APP_STORE_CONNECT_PRIVATE_KEY_INVALID');
    }
    privateKey = createPrivateKey({ key: keyBytes, format: 'pem' });
    if (privateKey.asymmetricKeyType !== 'ec'
      || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      reject('APP_STORE_CONNECT_PRIVATE_KEY_INVALID');
    }
  } catch (error) {
    if (error?.message === 'APP_STORE_CONNECT_PRIVATE_KEY_INVALID') throw error;
    reject('APP_STORE_CONNECT_PRIVATE_KEY_INVALID');
  } finally {
    keyBytes.fill(0);
  }
  return Object.freeze({
    keyKind,
    keyId,
    issuerId: keyKind === 'team' ? issuerId : null,
    privateKey,
  });
}

export function createJwt(credentials, { now = Date.now() } = {}) {
  if (!credentials?.privateKey || !Number.isFinite(now)) {
    reject('APP_STORE_CONNECT_JWT_INVALID');
  }
  const issuedAt = Math.floor(now / 1000) - 5;
  const header = base64url(JSON.stringify({
    alg: 'ES256',
    kid: credentials.keyId,
    typ: 'JWT',
  }));
  const identity = credentials.keyKind === 'team'
    ? { iss: credentials.issuerId }
    : credentials.keyKind === 'individual'
      ? { sub: 'user' }
      : null;
  if (identity === null) reject('APP_STORE_CONNECT_JWT_INVALID');
  const payload = base64url(JSON.stringify({
    ...identity,
    iat: issuedAt,
    exp: issuedAt + 19 * 60,
    aud: 'appstoreconnect-v1',
  }));
  const signingInput = `${header}.${payload}`;
  let signature;
  try {
    signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
      key: credentials.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
  } catch {
    reject('APP_STORE_CONNECT_JWT_INVALID');
  }
  if (signature.length !== 64) reject('APP_STORE_CONNECT_JWT_INVALID');
  return `${signingInput}.${base64url(signature)}`;
}
