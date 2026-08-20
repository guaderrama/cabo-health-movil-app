interface IntroContinuationOptions {
  onComplete: () => void | Promise<void>;
}

export interface IntroContinuation {
  complete: () => Promise<void>;
}

export function createIntroContinuation({
  onComplete,
}: IntroContinuationOptions): IntroContinuation {
  let finishPromise: Promise<void> | undefined;

  function complete(): Promise<void> {
    if (finishPromise) return finishPromise;

    finishPromise = Promise.resolve().then(onComplete);
    return finishPromise;
  }

  return {
    complete,
  };
}
