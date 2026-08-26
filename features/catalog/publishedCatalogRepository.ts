import {
  parsePublishedCatalog,
  type PublishedCatalogSnapshot,
} from './publishedCatalog';
import {
  readPublishedCatalogCache,
  type PublishedCatalogStorage,
  writePublishedCatalogCache,
} from './publishedCatalogCache';

export interface PublishedCatalogRepository {
  readCached(): Promise<PublishedCatalogSnapshot | null>;
  refresh(): Promise<PublishedCatalogSnapshot | null>;
}

export function createPublishedCatalogRepository({
  storage,
  fetchPublishedCatalog,
}: {
  readonly storage: PublishedCatalogStorage;
  readonly fetchPublishedCatalog: () => Promise<unknown>;
}): PublishedCatalogRepository {
  return Object.freeze({
    readCached: () => readPublishedCatalogCache(storage),
    refresh: async () => {
      const cached = await readPublishedCatalogCache(storage);
      let response: unknown;
      try {
        response = await fetchPublishedCatalog();
      } catch {
        return null;
      }
      const snapshot = parsePublishedCatalog(response);
      if (!snapshot) return null;
      if (cached && snapshot.revision <= cached.revision) return cached;
      await writePublishedCatalogCache(storage, snapshot).catch(() => {});
      return snapshot;
    },
  });
}
