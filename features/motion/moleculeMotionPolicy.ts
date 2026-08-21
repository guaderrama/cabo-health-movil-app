export interface MoleculeMotionState {
  active: boolean;
  appActive: boolean;
  reduceMotion: boolean | null;
}

export interface MoleculeDriftLayer {
  durationMs: number;
  translateX: number;
  translateY: number;
}

// The native artwork mirrors the slow, independently drifting node groups used
// by the hosted CaboHealth network canvas. Distances stay small because this is
// a frequently seen ambient layer, not foreground animation.
export const MOLECULE_DRIFT_PLAN: readonly MoleculeDriftLayer[] = Object.freeze([
  Object.freeze({ durationMs: 7200, translateX: 5, translateY: -5 }),
  Object.freeze({ durationMs: 9200, translateX: -6, translateY: 4 }),
  Object.freeze({ durationMs: 11400, translateX: 4, translateY: 6 }),
]);

export function allowsMoleculeMotion({
  active,
  appActive,
  reduceMotion,
}: MoleculeMotionState): boolean {
  return active && appActive && reduceMotion === false;
}

export async function resolveReducedMotion(
  query: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await query();
  } catch {
    return true;
  }
}

interface MoleculeLoopDependencies<Handle> {
  start: () => Handle;
  stop: (handle: Handle) => void;
  showStatic: () => void;
}

export interface MoleculeLoopController {
  reconcile: (allowMotion: boolean) => void;
  destroy: () => void;
}

export function createMoleculeLoopController<Handle>({
  start,
  stop,
  showStatic,
}: MoleculeLoopDependencies<Handle>): MoleculeLoopController {
  let handle: Handle | undefined;
  let state: 'uninitialized' | 'running' | 'static' = 'uninitialized';

  function reconcile(allowMotion: boolean) {
    if (allowMotion) {
      if (state === 'running') return;
      handle = start();
      state = 'running';
      return;
    }

    if (state === 'static') return;
    if (handle !== undefined) stop(handle);
    handle = undefined;
    showStatic();
    state = 'static';
  }

  function destroy() {
    if (state === 'static') return;
    if (handle !== undefined) stop(handle);
    handle = undefined;
    showStatic();
    state = 'static';
  }

  return { reconcile, destroy };
}
