export const INTRO_AUTO_CONTINUE_MS = 1600;

export function getIntroAutoContinueDelay(reduceMotion: boolean): number {
  return reduceMotion ? 0 : INTRO_AUTO_CONTINUE_MS;
}

type ReplayParameter = string | string[] | undefined;

export function shouldShowIntro({
  completed,
  replay,
}: {
  completed: boolean;
  replay?: ReplayParameter;
}): boolean {
  const replayValue = Array.isArray(replay) ? replay[0] : replay;
  return !completed || replayValue === '1';
}

interface IntroContinuationOptions<Handle> {
  reduceMotion: boolean;
  schedule: (callback: () => void, delayMs: number) => Handle;
  cancel: (handle: Handle) => void;
  onComplete: () => void | Promise<void>;
}

export interface IntroContinuation {
  start: () => void;
  cancelPending: () => void;
  complete: () => Promise<void>;
  readonly completion: Promise<void>;
}

export function createIntroContinuation<Handle>({
  reduceMotion,
  schedule,
  cancel,
  onComplete,
}: IntroContinuationOptions<Handle>): IntroContinuation {
  let timer: Handle | undefined;
  let finishPromise: Promise<void> | undefined;

  function cancelPending() {
    if (timer === undefined) return;
    cancel(timer);
    timer = undefined;
  }

  function complete(): Promise<void> {
    if (finishPromise) return finishPromise;

    cancelPending();
    finishPromise = Promise.resolve().then(onComplete);
    return finishPromise;
  }

  function start() {
    if (finishPromise || timer !== undefined) return;

    const delayMs = getIntroAutoContinueDelay(reduceMotion);
    if (delayMs === 0) {
      void complete();
      return;
    }

    timer = schedule(() => {
      timer = undefined;
      void complete();
    }, delayMs);
  }

  return {
    start,
    cancelPending,
    complete,
    get completion() {
      return finishPromise ?? Promise.resolve();
    },
  };
}
