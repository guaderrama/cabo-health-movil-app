import type { CaboHealthMiniappIconName } from '../../components/icons/CaboHealthMiniappIcon';
import { resolveCatalogMiniappIcon } from '../catalog/catalogPresentation';
import type { PublishedClientPreview } from '../catalog/publishedCatalog';
import type {
  ClientAccessSnapshot,
  ClientResourceView,
} from './clientAccessController';

export interface ClientHomeCard {
  readonly access: 'client';
  readonly iconKey: CaboHealthMiniappIconName;
  readonly id: string;
  readonly locked: boolean;
  readonly summary: Readonly<{ en: string; es: string }>;
  readonly title: Readonly<{ en: string; es: string }>;
}

export type ClientHomeAccessState = Readonly<Pick<
  ClientAccessSnapshot,
  'grant' | 'status'
>>;

export function buildClientHomeCards(
  previews: readonly Readonly<PublishedClientPreview>[],
  access: ClientHomeAccessState,
): readonly Readonly<ClientHomeCard>[] {
  const resources = access.status === 'unlocked' && access.grant !== null
    ? access.grant.resources
    : [];
  const resourcesById = new Map<string, Readonly<ClientResourceView>>();
  for (const resource of resources) {
    if (!resourcesById.has(resource.id)) resourcesById.set(resource.id, resource);
  }

  const cards: Readonly<ClientHomeCard>[] = [];
  const seenIds = new Set<string>();
  for (const preview of previews) {
    if (seenIds.has(preview.id)) continue;
    seenIds.add(preview.id);
    const resource = resourcesById.get(preview.id);
    cards.push(resource ? unlockedCard(resource) : lockedCard(preview));
  }
  for (const resource of resources) {
    if (seenIds.has(resource.id)) continue;
    seenIds.add(resource.id);
    cards.push(unlockedCard(resource));
  }

  return Object.freeze(cards);
}

function lockedCard(preview: Readonly<PublishedClientPreview>): Readonly<ClientHomeCard> {
  return Object.freeze({
    access: 'client',
    iconKey: resolveCatalogMiniappIcon(preview.icon, preview.id),
    id: preview.id,
    locked: true,
    summary: Object.freeze({ en: preview.summary.en, es: preview.summary['es-MX'] }),
    title: Object.freeze({ en: preview.title.en, es: preview.title['es-MX'] }),
  });
}

function unlockedCard(resource: Readonly<ClientResourceView>): Readonly<ClientHomeCard> {
  return Object.freeze({
    access: 'client',
    iconKey: resource.iconKey === 'featured'
      ? resolveCatalogMiniappIcon('featured', resource.id)
      : resource.iconKey as CaboHealthMiniappIconName,
    id: resource.id,
    locked: false,
    summary: Object.freeze({ en: resource.summary.en, es: resource.summary.es }),
    title: Object.freeze({ en: resource.title.en, es: resource.title.es }),
  });
}
