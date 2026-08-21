import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDevMiniapp,
  getVisibleDevMiniapps,
  isDevMiniappPanelEnabled,
  removeDevMiniapp,
  setDevMiniappActive,
  type CreateDevMiniappResult,
  type DevMiniapp,
  type DevMiniappInput,
} from './devMiniappCatalog';
import { readDevMiniapps, writeDevMiniapps } from './devMiniappStore';

export function useDevMiniapps() {
  const enabled = isDevMiniappPanelEnabled(__DEV__);
  const [miniapps, setMiniapps] = useState<readonly Readonly<DevMiniapp>[]>([]);
  const [saving, setSaving] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    void readDevMiniapps(AsyncStorage, __DEV__).then((stored) => {
      if (active) setMiniapps(stored);
    }).catch(() => {
      if (active) setStorageError(true);
    });
    return () => { active = false; };
  }, []);

  const persist = useCallback(async (next: readonly Readonly<DevMiniapp>[]) => {
    if (!enabled || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      await writeDevMiniapps(AsyncStorage, __DEV__, next);
      setMiniapps(next);
      setStorageError(false);
      return true;
    } catch {
      setStorageError(true);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [enabled]);

  const addMiniapp = useCallback(async (
    input: Readonly<DevMiniappInput>,
  ): Promise<CreateDevMiniappResult> => {
    const result = createDevMiniapp(input, miniapps);
    if (!result.ok) return result;
    const stored = await persist([...miniapps, result.value]);
    return stored
      ? result
      : { ok: false, reason: 'The test miniapp could not be saved.' };
  }, [miniapps, persist]);

  const toggleMiniapp = useCallback(async (id: string, active: boolean) => (
    persist(setDevMiniappActive(miniapps, id, active))
  ), [miniapps, persist]);

  const deleteMiniapp = useCallback(async (id: string) => (
    persist(removeDevMiniapp(miniapps, id))
  ), [miniapps, persist]);

  return useMemo(() => ({
    enabled,
    miniapps,
    visibleMiniapps: getVisibleDevMiniapps(miniapps),
    saving,
    storageError,
    addMiniapp,
    toggleMiniapp,
    deleteMiniapp,
  }), [addMiniapp, deleteMiniapp, enabled, miniapps, saving, storageError, toggleMiniapp]);
}
