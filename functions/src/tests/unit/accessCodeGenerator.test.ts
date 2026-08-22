import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateAccessCode } from '../../security/accessCodeGenerator.js';

test('a client code carries 128 bits supplied by a cryptographic random source', () => {
  let requestedBytes = 0;
  const code = generateAccessCode((size) => {
    requestedBytes = size;
    return Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  });

  assert.equal(requestedBytes, 16);
  assert.equal(code, 'CH-00112233-44556677-8899AABB-CCDDEEFF');
});
