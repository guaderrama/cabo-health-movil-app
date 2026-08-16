import frozenContactFacts from '../release/public-contact-facts.json';
import {
  canUseContactActions,
  type PublicContactFacts,
} from '../features/resources/publicContactEligibility';

export function getConfirmedPublicContactUrls(
  record: PublicContactFacts,
): readonly string[] {
  if (!canUseContactActions(record)) return [];

  const urls: string[] = [];
  const { publicEmail, phone, whatsApp, appleMapsDestination } = record.facts;
  if (
    typeof publicEmail.value !== 'string'
    || typeof phone.value !== 'string'
    || typeof whatsApp.value !== 'string'
    || typeof appleMapsDestination.value !== 'string'
  ) return [];

  const hasUnsafeText = (value: string) => /[\u0000-\u0020\u007f\\]/u.test(value);
  if (
    hasUnsafeText(publicEmail.value)
    || hasUnsafeText(phone.value)
    || !isExactContactWebUrl(appleMapsDestination.value, 'maps.apple.com')
    || !isExactContactWebUrl(whatsApp.value, 'wa.me')
  ) return [];

  urls.push(`mailto:${publicEmail.value}`);
  urls.push(`tel:${phone.value}`);
  urls.push(appleMapsDestination.value);
  urls.push(whatsApp.value);
  return Object.freeze(urls);
}

function isExactContactWebUrl(value: string, host: string): boolean {
  if (/[\u0000-\u0020\u007f\\]/u.test(value) || !value.startsWith(`https://${host}/`)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname === host
      && parsed.username === ''
      && parsed.password === ''
      && parsed.port === '';
  } catch {
    return false;
  }
}

export const PUBLIC_CONTACT_URLS = getConfirmedPublicContactUrls(
  frozenContactFacts as PublicContactFacts,
);
