import { useLocalSearchParams } from 'expo-router';
import NotFoundScreen from '../+not-found';
import { getPublicMiniapp } from '../../constants/publicMiniapps';
import { LoadingIndicator } from '../../components';
import { RestrictedWebView } from '../../features/launch/RestrictedWebView';
import {
  resolvePublicMiniappRouteSlug,
  shouldWaitForPublicCatalogRoute,
} from '../../features/launch/navigationPolicy';
import { usePublicCatalog } from '../../context/PublicCatalogContext';

export default function PublicMiniappRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const { miniapps, getMiniapp, isLoading } = usePublicCatalog();
  const resolvedSlug = resolvePublicMiniappRouteSlug(slug, miniapps);
  const miniapp = resolvedSlug
    ? getMiniapp(resolvedSlug) ?? getPublicMiniapp(resolvedSlug)
    : undefined;

  if (shouldWaitForPublicCatalogRoute(slug, isLoading)) return <LoadingIndicator />;
  if (!miniapp) return <NotFoundScreen />;
  return <RestrictedWebView miniapp={miniapp} />;
}
