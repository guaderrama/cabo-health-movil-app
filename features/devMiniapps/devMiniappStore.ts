import {
  isDevMiniappPanelEnabled,
  parseDevMiniappCatalog,
  type DevMiniapp,
} from './devMiniappCatalog';

export const DEV_MINIAPP_STORAGE_KEY = '@cabohealth_dev_miniapps_v1';

export interface DevMiniappStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export async function readDevMiniapps(
  storage: DevMiniappStorage,
  runtimeIsDev: boolean,
): Promise<readonly Readonly<DevMiniapp>[]> {
  if (!isDevMiniappPanelEnabled(runtimeIsDev)) return [];
  const stored = await storage.getItem(DEV_MINIAPP_STORAGE_KEY);
  return stored === null ? [] : parseDevMiniappCatalog(stored);
}

export async function writeDevMiniapps(
  storage: DevMiniappStorage,
  runtimeIsDev: boolean,
  miniapps: readonly Readonly<DevMiniapp>[],
): Promise<void> {
  if (!isDevMiniappPanelEnabled(runtimeIsDev)) return;
  await storage.setItem(DEV_MINIAPP_STORAGE_KEY, JSON.stringify(miniapps));
}
