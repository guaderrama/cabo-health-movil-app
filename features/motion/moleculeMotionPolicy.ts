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

// The native artwork mirrors the independently drifting node groups used by
// the hosted CaboHealth network canvas. The movement must remain visible on a
// phone without competing with foreground content.
export const MOLECULE_DRIFT_PLAN: readonly MoleculeDriftLayer[] = Object.freeze([
  Object.freeze({ durationMs: 4200, translateX: 12, translateY: -10 }),
  Object.freeze({ durationMs: 5400, translateX: -14, translateY: 9 }),
  Object.freeze({ durationMs: 6800, translateX: 10, translateY: 15 }),
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
