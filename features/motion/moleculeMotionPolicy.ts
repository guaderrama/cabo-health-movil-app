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

export interface RichCenterParticle {
  x: number;
  y: number;
  size: number;
  warm: boolean;
}

// The native artwork mirrors the independently drifting node groups used by
// the hosted CaboHealth network canvas. The movement must remain visible on a
// phone without competing with foreground content.
export const MOLECULE_DRIFT_PLAN: readonly MoleculeDriftLayer[] = Object.freeze([
  Object.freeze({ durationMs: 4200, translateX: 12, translateY: -10 }),
  Object.freeze({ durationMs: 5400, translateX: -14, translateY: 9 }),
  Object.freeze({ durationMs: 6800, translateX: 10, translateY: 15 }),
]);

// Rich surfaces add a quiet center field so the network does not read as an
// edge-only frame. Warm nodes stay a minority and reuse the brand bronze.
export const RICH_CENTER_PARTICLE_PLAN: readonly Readonly<RichCenterParticle>[] = Object.freeze([
  Object.freeze({ x: 0.46, y: 80, size: 2, warm: false }),
  Object.freeze({ x: 0.57, y: 135, size: 2.5, warm: true }),
  Object.freeze({ x: 0.37, y: 195, size: 2, warm: false }),
  Object.freeze({ x: 0.63, y: 250, size: 3, warm: false }),
  Object.freeze({ x: 0.48, y: 305, size: 2.5, warm: true }),
  Object.freeze({ x: 0.58, y: 365, size: 2, warm: false }),
  Object.freeze({ x: 0.42, y: 425, size: 3.5, warm: false }),
  Object.freeze({ x: 0.53, y: 485, size: 2, warm: false }),
  Object.freeze({ x: 0.35, y: 545, size: 2.5, warm: false }),
  Object.freeze({ x: 0.65, y: 605, size: 2.5, warm: true }),
  Object.freeze({ x: 0.47, y: 665, size: 3, warm: false }),
  Object.freeze({ x: 0.58, y: 725, size: 2, warm: false }),
  Object.freeze({ x: 0.40, y: 785, size: 2.5, warm: false }),
  Object.freeze({ x: 0.52, y: 845, size: 3.5, warm: true }),
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
