export class AdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AdapterError';
  }
}

export function reject(code) {
  throw new AdapterError(code);
}

export function publicErrorCode(error) {
  return error instanceof AdapterError
    ? error.message
    : 'APP_STORE_SUBMIT_INTERNAL_ERROR';
}
