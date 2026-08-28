import {
  parsePublishedCatalog,
  type PublishedCatalogSnapshot,
} from './publishedCatalog';

export const PUBLISHED_CATALOG_CACHE_KEY = '@cabohealth_published_catalog_v3';

export interface PublishedCatalogStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export async function readPublishedCatalogCache(
  storage: PublishedCatalogStorage,
): Promise<PublishedCatalogSnapshot | null> {
  try {
    const serialized = await storage.getItem(PUBLISHED_CATALOG_CACHE_KEY);
    if (serialized === null) return null;
    return parsePublishedCatalog(JSON.parse(serialized) as unknown);
  } catch {
    return null;
  }
}

export async function writePublishedCatalogCache(
  storage: PublishedCatalogStorage,
  snapshot: PublishedCatalogSnapshot,
): Promise<void> {
  await storage.setItem(PUBLISHED_CATALOG_CACHE_KEY, JSON.stringify(snapshot));
}
