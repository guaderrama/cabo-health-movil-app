import { randomBytes } from 'node:crypto';

export type CryptographicRandomSource = (size: number) => Buffer;

const ACCESS_CODE_BYTES = 16;

export function generateAccessCode(
  randomSource: CryptographicRandomSource = randomBytes,
): string {
  const entropy = randomSource(ACCESS_CODE_BYTES);
  if (entropy.length !== ACCESS_CODE_BYTES) {
    throw new Error('cryptographic_random_source_failed');
  }

  const encoded = entropy.toString('hex').toUpperCase();
  return `CH-${encoded.match(/.{8}/gu)!.join('-')}`;
}

export function normalizeAccessCode(rawCode: string): string | null {
  if (
    typeof rawCode !== 'string'
    || rawCode.length > 96
    || /[\u0000-\u001f\u007f]/u.test(rawCode)
  ) return null;

  const normalized = rawCode
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/gu, '-');
  const body = normalized.startsWith('CH-') ? normalized.slice(3) : normalized;
  const compact = body.replace(/[ -]/gu, '');
  if (!/^[A-F0-9]{32}$/u.test(compact)) return null;
  return `CH-${compact.match(/.{8}/gu)!.join('-')}`;
}
