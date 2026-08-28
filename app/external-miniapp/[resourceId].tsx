import { useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import NotFoundScreen from '../+not-found';
import { LoadingIndicator } from '../../components';
import { usePublicCatalog } from '../../context/PublicCatalogContext';
import {
  type ExternalMiniappExpectedDestination,
  resolveExternalMiniappRouteState,
} from '../../features/catalog/publicMiniappRoute';
import { ExternalHttpsWebView } from '../../features/launch/ExternalHttpsWebView';

export default function ExternalPublicMiniappRoute() {
  const { resourceId } = useLocalSearchParams<{ resourceId?: string | string[] }>();
  const { miniapps, isInitialLoading } = usePublicCatalog();
  const expectedDestinationRef = useRef<ExternalMiniappExpectedDestination | null>(null);
  const state = resolveExternalMiniappRouteState({
    resourceId,
    catalog: miniapps,
    isInitialLoading,
    ...(expectedDestinationRef.current
      ? { expectedDestination: expectedDestinationRef.current }
      : {}),
  });

  if (state.kind === 'ready' && expectedDestinationRef.current === null) {
    expectedDestinationRef.current = {
      resourceId: state.miniapp.slug,
      destinationUrl: state.miniapp.destinationUrl,
      destinationOrigin: state.miniapp.destinationOrigin,
    };
  }

  if (state.kind === 'loading') return <LoadingIndicator />;
  if (state.kind !== 'ready') return <NotFoundScreen />;
  return <ExternalHttpsWebView miniapp={state.miniapp} />;
}
