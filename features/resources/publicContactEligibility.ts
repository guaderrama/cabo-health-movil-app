export interface PublicContactFact {
  value: string | readonly string[] | null;
  sourceUrl: string | null;
  sourceStatus: 'owner-confirmation-required' | 'owner-confirmed-source';
}

export interface PublicContactFacts {
  status: 'awaiting-owner-confirmation' | 'owner-confirmed';
  ownerConfirmedAt: string | null;
  facts: Record<string, PublicContactFact>;
}

export const REQUIRED_PUBLIC_CONTACT_FACT_KEYS = [
  'publicEmail',
  'phone',
  'whatsApp',
  'address',
  'hours',
  'appleMapsDestination',
  'serviceLanguages',
] as const;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u;

export function canUseContactActions(record: PublicContactFacts): boolean {
  if (
    record.status !== 'owner-confirmed'
    || typeof record.ownerConfirmedAt !== 'string'
    || !ISO_TIMESTAMP.test(record.ownerConfirmedAt)
    || Number.isNaN(Date.parse(record.ownerConfirmedAt))
  ) return false;

  const keys = Object.keys(record.facts);
  if (
    keys.length !== REQUIRED_PUBLIC_CONTACT_FACT_KEYS.length
    || REQUIRED_PUBLIC_CONTACT_FACT_KEYS.some((key) => !Object.hasOwn(record.facts, key))
  ) return false;

  return REQUIRED_PUBLIC_CONTACT_FACT_KEYS.every((key) => {
    const fact = record.facts[key];
    const hasExpectedValueShape = key === 'serviceLanguages'
      ? Array.isArray(fact.value)
        && fact.value.length > 0
        && fact.value.every((value) => typeof value === 'string' && value.trim().length > 0)
      : typeof fact.value === 'string' && fact.value.trim().length > 0;
    if (!hasExpectedValueShape || fact.sourceStatus !== 'owner-confirmed-source') return false;
    if (typeof fact.sourceUrl !== 'string' || fact.sourceUrl.trim() !== fact.sourceUrl) return false;

    try {
      return new URL(fact.sourceUrl).protocol === 'https:';
    } catch {
      return false;
    }
  });
}
