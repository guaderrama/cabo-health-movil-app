export const PERMANENTLY_RETIRED_CATALOG_IDS = Object.freeze([
  'health-advisor',
  'ai-cosmetic-scan',
  'service-hub',
  'sleep-lab',
] as const);

const PERMANENTLY_RETIRED_CATALOG_ID_SET = new Set<string>(
  PERMANENTLY_RETIRED_CATALOG_IDS,
);
const REVIEW_SANDBOX_CATALOG_ID_PREFIX = 'review-sandbox-';

export function isPermanentlyRetiredCatalogId(value: unknown): boolean {
  return typeof value === 'string' && PERMANENTLY_RETIRED_CATALOG_ID_SET.has(value);
}

export function isReservedReviewSandboxCatalogId(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(REVIEW_SANDBOX_CATALOG_ID_PREFIX);
}
