import type { ClientInstallationPort } from './firebaseClientAccessAdapter';

export const CLIENT_INSTALLATION_KEY = 'cabohealth.client.installation.v1';
const INSTALLATION_BYTES = 32;
const INSTALLATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export interface ClientInstallationSecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export function createClientInstallationPort({
  storage,
  randomBytes,
}: {
  readonly storage: ClientInstallationSecureStorage;
  readonly randomBytes: (length: number) => Promise<Uint8Array>;
}): ClientInstallationPort {
  let pending: Promise<string> | null = null;

  const loadOrCreate = async () => {
    const stored = await storage.getItem(CLIENT_INSTALLATION_KEY);
    if (stored !== null && INSTALLATION_PATTERN.test(stored)) return stored;
    if (stored !== null) await storage.deleteItem(CLIENT_INSTALLATION_KEY);

    const entropy = await randomBytes(INSTALLATION_BYTES);
    if (!(entropy instanceof Uint8Array) || entropy.length !== INSTALLATION_BYTES) {
      throw new Error('client_installation_random_failed');
    }
    const created = encodeBase64Url(entropy);
    if (!INSTALLATION_PATTERN.test(created)) {
      throw new Error('client_installation_random_failed');
    }
    await storage.setItem(CLIENT_INSTALLATION_KEY, created);
    const verified = await storage.getItem(CLIENT_INSTALLATION_KEY);
    if (verified !== created) {
      await storage.deleteItem(CLIENT_INSTALLATION_KEY).catch(() => {});
      throw new Error('client_installation_persistence_failed');
    }
    return created;
  };

  return Object.freeze({
    getOrCreate: () => {
      if (!pending) {
        pending = loadOrCreate().finally(() => {
          pending = null;
        });
      }
      return pending;
    },
    clear: async () => {
      if (pending) await pending.catch(() => {});
      await storage.deleteItem(CLIENT_INSTALLATION_KEY);
    },
  });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const secondPresent = offset + 1 < bytes.length;
    const thirdPresent = offset + 2 < bytes.length;
    const second = secondPresent ? bytes[offset + 1]! : 0;
    const third = thirdPresent ? bytes[offset + 2]! : 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64URL_ALPHABET[(value >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(value >>> 12) & 63];
    if (secondPresent) encoded += BASE64URL_ALPHABET[(value >>> 6) & 63];
    if (thirdPresent) encoded += BASE64URL_ALPHABET[value & 63];
  }
  return encoded;
}
