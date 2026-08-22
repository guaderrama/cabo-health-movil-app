import { Slot, useUnstableGlobalHref } from 'expo-router';
import NotFoundScreen from '../../+not-found';
import { classifyClientResourceDeepLink } from '../../../features/clientAccess/clientResourceDeepLink';

export default function ClientResourceRouteLayout() {
  const href = useUnstableGlobalHref();
  const decision = classifyClientResourceDeepLink(href);

  if (decision.decision !== 'open-native-client-access') return <NotFoundScreen />;
  return <Slot />;
}
