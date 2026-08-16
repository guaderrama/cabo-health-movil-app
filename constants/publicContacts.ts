import frozenContactFacts from '../release/public-contact-facts.json';

type ContactFact = Readonly<{
  value: string | null;
  sourceUrl: string | null;
  sourceStatus: string;
}>;

export type PublicContactFacts = Readonly<{
  status: string;
  ownerConfirmedAt: string | null;
  facts: Readonly<{
    publicEmail: ContactFact;
    phone: ContactFact;
    whatsApp: ContactFact;
    appleMapsDestination: ContactFact;
  }>;
}>;

export function getConfirmedPublicContactUrls(
  record: PublicContactFacts,
): readonly string[] {
  if (record.status !== 'owner-confirmed' || record.ownerConfirmedAt === null) return [];

  const confirmedAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;
  if (
    !confirmedAtPattern.test(record.ownerConfirmedAt)
    || Number.isNaN(Date.parse(record.ownerConfirmedAt))
  ) return [];

  const urls: string[] = [];
  const { publicEmail, phone, whatsApp, appleMapsDestination } = record.facts;
  const contactFacts = [publicEmail, phone, whatsApp, appleMapsDestination];
  if (contactFacts.some((fact) => (
    fact.value === null
    || fact.sourceStatus !== 'owner-confirmed-source'
    || typeof fact.sourceUrl !== 'string'
  ))) return [];

  const hasUnsafeText = (value: string) => /[\u0000-\u0020\u007f\\]/u.test(value);
  if (
    hasUnsafeText(publicEmail.value!)
    || hasUnsafeText(phone.value!)
    || !isExactContactWebUrl(appleMapsDestination.value!, 'maps.apple.com')
    || !isExactContactWebUrl(whatsApp.value!, 'wa.me')
  ) return [];

  urls.push(`mailto:${publicEmail.value!}`);
  urls.push(`tel:${phone.value!}`);
  urls.push(appleMapsDestination.value!);
  urls.push(whatsApp.value!);
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
  frozenContactFacts satisfies PublicContactFacts,
);
