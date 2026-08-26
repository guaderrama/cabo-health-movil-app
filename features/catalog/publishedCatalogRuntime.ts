import type { PublishedCatalogRepository } from './publishedCatalogRepository';

/** Web and unsupported runtimes keep the bundled public catalog. */
export async function loadPublishedCatalogRepository(): Promise<PublishedCatalogRepository | null> {
  return null;
}
