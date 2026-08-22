import type { FirebaseClientAccessAdapter } from './firebaseClientAccessAdapter';

/** Web and non-native runtimes never receive client credentials. */
export async function loadClientAccessRuntime(): Promise<FirebaseClientAccessAdapter | null> {
  return null;
}
