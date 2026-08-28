import { useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import NotFoundScreen from '../+not-found';
import { LoadingIndicator } from '../../components';
import { usePublicCatalog } from '../../context/PublicCatalogContext';
import {
  createExternalMiniappRouteStateMachine,
  type ExternalMiniappRouteStateMachine,
} from '../../features/catalog/publicMiniappRoute';
import { ExternalHttpsWebView } from '../../features/launch/ExternalHttpsWebView';

export default function ExternalPublicMiniappRoute() {
  const { resourceId } = useLocalSearchParams<{ resourceId?: string | string[] }>();
  const { miniapps, isInitialLoading } = usePublicCatalog();
  const routeStateMachineRef = useRef<ExternalMiniappRouteStateMachine | null>(null);
  if (routeStateMachineRef.current === null) {
    routeStateMachineRef.current = createExternalMiniappRouteStateMachine();
  }
  const state = routeStateMachineRef.current.resolve({
    resourceId,
    catalog: miniapps,
    isInitialLoading,
  });

  if (state.kind === 'loading') return <LoadingIndicator />;
  if (state.kind !== 'ready') return <NotFoundScreen />;
  return <ExternalHttpsWebView miniapp={state.miniapp} />;
}
