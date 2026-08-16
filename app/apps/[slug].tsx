import { useLocalSearchParams } from 'expo-router';
import NotFoundScreen from '../+not-found';
import { getPublicMiniapp } from '../../constants/publicMiniapps';
import { RestrictedWebView } from '../../features/launch/RestrictedWebView';
import { resolvePublicMiniappRouteSlug } from '../../features/launch/navigationPolicy';

export default function PublicMiniappRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const resolvedSlug = resolvePublicMiniappRouteSlug(slug);
  const miniapp = resolvedSlug ? getPublicMiniapp(resolvedSlug) : undefined;

  if (!miniapp) return <NotFoundScreen />;
  return <RestrictedWebView miniapp={miniapp} />;
}
