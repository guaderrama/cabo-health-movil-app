import type {
  NativeAppCheckOptions,
  NativeClientAccessBridge,
} from './nativeClientAccessRuntime';

interface NativePrincipal {
  readonly uid: string;
}

interface NativeFirebaseAppLike {
  readonly options: Readonly<{ projectId?: string }>;
}

interface NativeAuthLike {
  readonly currentUser: NativePrincipal | null;
}

interface NativeProviderLike {
  configure(options: Readonly<{
    apple: Readonly<{
      provider: NativeAppCheckOptions['appleProvider'];
    }>;
    android: Readonly<{
      provider: NativeAppCheckOptions['androidProvider'];
    }>;
  }>): void;
}

export interface ReactNativeFirebaseModules {
  readonly app: {
    getApp(): NativeFirebaseAppLike;
  };
  readonly auth: {
    getAuth(app: NativeFirebaseAppLike): NativeAuthLike;
    onAuthStateChanged(
      auth: NativeAuthLike,
      observer: (user: NativePrincipal | null) => void,
    ): () => void;
    signInWithCustomToken(
      auth: NativeAuthLike,
      customToken: string,
    ): Promise<Readonly<{ user: NativePrincipal }>>;
    signOut(auth: NativeAuthLike): Promise<void>;
  };
  readonly functions: {
    getFunctions(app: NativeFirebaseAppLike, region: string): unknown;
    httpsCallable(
      functions: unknown,
      name: string,
      options: Readonly<{ limitedUseAppCheckTokens: true }>,
    ): (data: Readonly<Record<string, unknown>>) => Promise<Readonly<{ data: unknown }>>;
  };
  readonly appCheck: {
    createProvider(): NativeProviderLike;
    initializeAppCheck(
      app: NativeFirebaseAppLike,
      options: Readonly<{
        provider: NativeProviderLike;
        isTokenAutoRefreshEnabled: true;
      }>,
    ): Promise<unknown>;
  };
}

export function createReactNativeFirebaseBridge(
  modules: ReactNativeFirebaseModules,
): NativeClientAccessBridge {
  const app = modules.app.getApp();
  const auth = modules.auth.getAuth(app);

  return Object.freeze({
    projectId: app.options.projectId ?? '',
    initializeAppCheck: async (options: NativeAppCheckOptions) => {
      const provider = modules.appCheck.createProvider();
      provider.configure({
        apple: {
          provider: options.appleProvider,
        },
        android: {
          provider: options.androidProvider,
        },
      });
      await modules.appCheck.initializeAppCheck(app, {
        provider,
        isTokenAutoRefreshEnabled: options.tokenAutoRefreshEnabled,
      });
    },
    auth: Object.freeze({
      waitForReady: () => new Promise<Readonly<NativePrincipal> | null>((resolve) => {
        let unsubscribe: (() => void) | undefined;
        unsubscribe = modules.auth.onAuthStateChanged(auth, (user) => {
          resolve(user === null ? null : Object.freeze({ uid: user.uid }));
          queueMicrotask(() => unsubscribe?.());
        });
      }),
      currentUser: () => auth.currentUser === null
        ? null
        : Object.freeze({ uid: auth.currentUser.uid }),
      signInWithCustomToken: async (customToken: string) => {
        const credential = await modules.auth.signInWithCustomToken(auth, customToken);
        return Object.freeze({ uid: credential.user.uid });
      },
      signOut: () => modules.auth.signOut(auth),
    }),
    functionsForRegion: (region: string) => {
      const functions = modules.functions.getFunctions(app, region);
      return Object.freeze({
        call: async (name: string, data: Readonly<Record<string, unknown>>) => {
          const callable = modules.functions.httpsCallable(functions, name, {
            limitedUseAppCheckTokens: true,
          });
          const response = await callable(data);
          return response.data;
        },
      });
    },
  });
}
