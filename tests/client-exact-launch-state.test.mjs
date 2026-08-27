import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRequestedResourceLaunchState,
} from '../.test-build/features/clientAccess/clientExactLaunchState.js';

const base = Object.freeze({
  handledResourceId: 'mitochondria',
  launchError: false,
  launchPendingId: null,
  requestedResourceAvailable: true,
  requestedResourceId: 'mitochondria',
  status: 'unlocked',
});

test('an exact launch interrupted by grant refresh schedules the same resource again', () => {
  assert.equal(resolveRequestedResourceLaunchState({
    ...base,
    handledResourceId: null,
    requestedResourceAvailable: false,
    status: 'checking',
  }), 'busy');
  assert.equal(resolveRequestedResourceLaunchState({
    ...base,
    handledResourceId: null,
  }), 'busy');
  assert.equal(resolveRequestedResourceLaunchState({
    ...base,
    launchPendingId: 'mitochondria',
  }), 'busy');
});

test('an exact launch becomes retryable only after a real failure or missing grant', () => {
  assert.equal(resolveRequestedResourceLaunchState({
    ...base,
    launchError: true,
  }), 'unavailable');
  assert.equal(resolveRequestedResourceLaunchState({
    ...base,
    requestedResourceAvailable: false,
  }), 'unavailable');
});
