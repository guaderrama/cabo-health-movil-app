import type { FirebaseCallablePort } from '../clientAccess/firebaseClientAccessAdapter';
import type {
  NativeAppCheckOptions,
  NativeClientAccessEnvironment,
} from '../clientAccess/nativeClientAccessRuntime';

export interface NativePublishedCatalogBridge {
  readonly projectId: string;
  initializeAppCheck(options: NativeAppCheckOptions): Promise<void>;
  functionsForRegion(region: string): FirebaseCallablePort;
}

export async function createNativePublishedCatalogFetcher({
  environment,
  loadBridge,
}: {
  readonly environment: NativeClientAccessEnvironment;
  readonly loadBridge: () => Promise<NativePublishedCatalogBridge>;
}): Promise<(() => Promise<unknown>) | null> {
  if (
    !environment.enabled
    || environment.isExpoGo
    || (environment.platform !== 'ios' && environment.platform !== 'android')
    || environment.expectedProjectId === null
    || !isDedicatedCaboHealthProjectId(environment.expectedProjectId)
    || (environment.appCheckDebugEnabled === true && environment.appEnvironment !== 'development')
  ) return null;

  try {
    const bridge = await loadBridge();
    if (bridge.projectId !== environment.expectedProjectId) return null;
    const useDebugProvider = environment.appEnvironment === 'development'
      && environment.appCheckDebugEnabled === true;
    await bridge.initializeAppCheck({
      appleProvider: useDebugProvider ? 'debug' : 'appAttestWithDeviceCheckFallback',
      androidProvider: useDebugProvider ? 'debug' : 'playIntegrity',
      tokenAutoRefreshEnabled: true,
    });
    const functions = bridge.functionsForRegion(environment.functionsRegion ?? 'us-central1');
    return () => functions.call('getPublishedCatalogV3', {});
  } catch {
    return null;
  }
}

function isDedicatedCaboHealthProjectId(value: string): boolean {
  return /^cabohealth-[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/u.test(value);
}
