import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type { FirebaseClientAccessAdapter } from './firebaseClientAccessAdapter';
import {
  createNativeClientAccessRuntime,
  parseNativeClientAccessEnvironment,
} from './nativeClientAccessRuntime';
import { createReactNativeFirebaseBridge } from './reactNativeFirebaseBridge';

const SECURE_STORE_OPTIONS = Object.freeze({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'com.cabohealth.client-access',
});
const REQUEST_ID_BYTES = 24;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export async function loadClientAccessRuntime(): Promise<FirebaseClientAccessAdapter | null> {
  const environment = parseNativeClientAccessEnvironment({
    platform: toRuntimePlatform(Platform.OS),
    isExpoGo: isRunningInExpoGo(),
    extra: Constants.expoConfig?.extra ?? null,
  });
  return createNativeClientAccessRuntime({
    environment,
    loadBridge: loadReactNativeFirebaseBridge,
    secureStorage: {
      getItem: (key) => SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS),
      setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS),
      deleteItem: (key) => SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS),
    },
    randomBytes: (length) => Crypto.getRandomBytesAsync(length),
    createRequestId: () => encodeBase64Url(
      Crypto.getRandomValues(new Uint8Array(REQUEST_ID_BYTES)),
    ),
  });
}

async function loadReactNativeFirebaseBridge() {
  const [appModule, authModule, functionsModule, appCheckModule] = await Promise.all([
    import('@react-native-firebase/app'),
    import('@react-native-firebase/auth'),
    import('@react-native-firebase/functions'),
    import('@react-native-firebase/app-check'),
  ]);
  const app = appModule.getApp();
  const auth = authModule.getAuth(app);
  return createReactNativeFirebaseBridge({
    app: { getApp: () => app },
    auth: {
      getAuth: () => auth,
      onAuthStateChanged: (_auth, observer) => authModule.onAuthStateChanged(
        auth,
        (user) => observer(user === null ? null : { uid: user.uid }),
      ),
      signInWithCustomToken: async (_auth, customToken) => {
        const credential = await authModule.signInWithCustomToken(auth, customToken);
        return { user: { uid: credential.user.uid } };
      },
      signOut: () => authModule.signOut(auth),
    },
    functions: {
      getFunctions: (_app, region) => functionsModule.getFunctions(app, region),
      httpsCallable: (instance, name, options) => {
        const callable = functionsModule.httpsCallable(
          instance as Parameters<typeof functionsModule.httpsCallable>[0],
          name,
          options,
        );
        return async (data) => {
          const response = await callable(data);
          return { data: response.data };
        };
      },
    },
    appCheck: {
      createProvider: () => new appCheckModule.ReactNativeFirebaseAppCheckProvider(),
      initializeAppCheck: async (_app, options) => {
        appCheckModule.initializeAppCheck(app, {
          provider: options.provider as unknown as InstanceType<
            typeof appCheckModule.ReactNativeFirebaseAppCheckProvider
          >,
          isTokenAutoRefreshEnabled: options.isTokenAutoRefreshEnabled,
        });
      },
    },
  });
}

function toRuntimePlatform(value: string): 'ios' | 'android' | 'web' | 'other' {
  if (value === 'ios' || value === 'android' || value === 'web') return value;
  return 'other';
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const secondPresent = offset + 1 < bytes.length;
    const thirdPresent = offset + 2 < bytes.length;
    const second = secondPresent ? bytes[offset + 1]! : 0;
    const third = thirdPresent ? bytes[offset + 2]! : 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64URL_ALPHABET[(value >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(value >>> 12) & 63];
    if (secondPresent) encoded += BASE64URL_ALPHABET[(value >>> 6) & 63];
    if (thirdPresent) encoded += BASE64URL_ALPHABET[value & 63];
  }
  return encoded;
}
