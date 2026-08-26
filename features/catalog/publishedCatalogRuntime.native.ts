import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import { loadReactNativeFirebaseBridge } from '../clientAccess/clientAccessRuntime.native';
import { parseNativeClientAccessEnvironment } from '../clientAccess/nativeClientAccessRuntime';
import { createNativePublishedCatalogFetcher } from './nativePublishedCatalogRuntime';
import {
  createPublishedCatalogRepository,
  type PublishedCatalogRepository,
} from './publishedCatalogRepository';

export async function loadPublishedCatalogRepository(): Promise<PublishedCatalogRepository | null> {
  const environment = parseNativeClientAccessEnvironment({
    platform: toRuntimePlatform(Platform.OS),
    isExpoGo: isRunningInExpoGo(),
    extra: Constants.expoConfig?.extra ?? null,
  });
  const fetchPublishedCatalog = await createNativePublishedCatalogFetcher({
    environment,
    loadBridge: loadReactNativeFirebaseBridge,
  });
  return createPublishedCatalogRepository({
    storage: AsyncStorage,
    fetchPublishedCatalog: fetchPublishedCatalog ?? (() => Promise.reject(
      new Error('published_catalog_runtime_unavailable'),
    )),
  });
}

function toRuntimePlatform(value: string): 'ios' | 'android' | 'web' | 'other' {
  if (value === 'ios' || value === 'android' || value === 'web') return value;
  return 'other';
}
