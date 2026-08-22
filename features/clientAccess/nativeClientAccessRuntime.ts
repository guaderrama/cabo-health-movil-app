import {
  createFirebaseClientAccessAdapter,
  type FirebaseCallablePort,
  type FirebaseClientAccessAdapter,
  type FirebaseClientAuthPort,
} from './firebaseClientAccessAdapter';
import {
  createClientInstallationPort,
  type ClientInstallationSecureStorage,
} from './clientInstallationStore';

export type CaboHealthAppEnvironment = 'development' | 'staging' | 'production';

export interface NativeClientAccessEnvironment {
  readonly platform: 'ios' | 'android' | 'web' | 'other';
  readonly isExpoGo: boolean;
  readonly enabled: boolean;
  readonly appEnvironment: CaboHealthAppEnvironment;
  readonly expectedProjectId: string | null;
  readonly appCheckDebugEnabled?: boolean;
  readonly functionsRegion?: string;
}

export interface NativeClientAccessBridge {
  readonly projectId: string;
  readonly auth: FirebaseClientAuthPort;
  initializeAppCheck(options: NativeAppCheckOptions): Promise<void>;
  functionsForRegion(region: string): FirebaseCallablePort;
}

export interface NativeAppCheckOptions {
  readonly appleProvider: 'debug' | 'appAttestWithDeviceCheckFallback';
  readonly androidProvider: 'debug' | 'playIntegrity';
  readonly tokenAutoRefreshEnabled: true;
}

export function parseNativeClientAccessEnvironment({
  platform,
  isExpoGo,
  extra,
}: {
  readonly platform: NativeClientAccessEnvironment['platform'];
  readonly isExpoGo: boolean;
  readonly extra: unknown;
}): NativeClientAccessEnvironment {
  const locked = Object.freeze({
    platform,
    isExpoGo,
    enabled: false,
    appEnvironment: 'development' as const,
    expectedProjectId: null,
    appCheckDebugEnabled: false,
    functionsRegion: 'us-central1',
  });
  if (!isRecord(extra) || !isRecord(extra.clientAccessRuntime)) return locked;
  const config = extra.clientAccessRuntime;
  if (
    config.enabled !== true
    || !isAppEnvironment(config.appEnvironment)
    || typeof config.expectedProjectId !== 'string'
    || !isDedicatedCaboHealthProjectId(config.expectedProjectId)
    || config.functionsRegion !== 'us-central1'
    || typeof config.appCheckDebugEnabled !== 'boolean'
    || (config.appCheckDebugEnabled && config.appEnvironment !== 'development')
  ) return locked;
  return Object.freeze({
    platform,
    isExpoGo,
    enabled: true,
    appEnvironment: config.appEnvironment,
    expectedProjectId: config.expectedProjectId,
    appCheckDebugEnabled: config.appCheckDebugEnabled,
    functionsRegion: config.functionsRegion,
  });
}

export async function createNativeClientAccessRuntime({
  environment,
  loadBridge,
  secureStorage,
  randomBytes,
  createRequestId,
}: {
  readonly environment: NativeClientAccessEnvironment;
  readonly loadBridge: () => Promise<NativeClientAccessBridge>;
  readonly secureStorage: ClientInstallationSecureStorage;
  readonly randomBytes: (length: number) => Promise<Uint8Array>;
  readonly createRequestId: () => string;
}): Promise<FirebaseClientAccessAdapter | null> {
  if (
    !environment.enabled
    || environment.isExpoGo
    || (environment.platform !== 'ios' && environment.platform !== 'android')
    || environment.expectedProjectId === null
    || (
      environment.appCheckDebugEnabled === true
      && environment.appEnvironment !== 'development'
    )
  ) return null;

  try {
    const bridge = await loadBridge();
    if (
      !isDedicatedCaboHealthProjectId(environment.expectedProjectId)
      || bridge.projectId !== environment.expectedProjectId
    ) return null;
    const useDebugProvider = environment.appEnvironment === 'development'
      && environment.appCheckDebugEnabled === true;
    await bridge.initializeAppCheck({
      appleProvider: useDebugProvider ? 'debug' : 'appAttestWithDeviceCheckFallback',
      androidProvider: useDebugProvider ? 'debug' : 'playIntegrity',
      tokenAutoRefreshEnabled: true,
    });
    const installation = createClientInstallationPort({
      storage: secureStorage,
      randomBytes,
    });
    return createFirebaseClientAccessAdapter({
      auth: bridge.auth,
      functions: bridge.functionsForRegion(environment.functionsRegion ?? 'us-central1'),
      installation,
      createRequestId,
    });
  } catch {
    return null;
  }
}

function isDedicatedCaboHealthProjectId(value: string): boolean {
  return /^cabohealth-[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAppEnvironment(value: unknown): value is CaboHealthAppEnvironment {
  return value === 'development' || value === 'staging' || value === 'production';
}
