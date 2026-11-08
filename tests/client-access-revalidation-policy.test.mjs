import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRevalidateClientAccessOnAppStateChange } from '../.test-build/features/clientAccess/clientAccessRevalidationPolicy.js';

test('client access revalidates only on a real return from the background', () => {
  // Arrange / Act / Assert
  assert.equal(shouldRevalidateClientAccessOnAppStateChange('background', 'active'), true);
  for (const previous of ['inactive', 'active', 'unknown', null]) {
    assert.equal(
      shouldRevalidateClientAccessOnAppStateChange(previous, 'active'),
      false,
      `Control Center / Siri / call / system alert must not relaunch (${previous})`,
    );
  }
  for (const next of ['background', 'inactive']) {
    assert.equal(shouldRevalidateClientAccessOnAppStateChange('active', next), false);
  }
});
