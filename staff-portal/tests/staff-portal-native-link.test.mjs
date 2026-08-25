import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('the consumer app excludes the owner-only Staff Portal and its exact URL', () => {
  const config = read('../constants/config.ts');
  const settings = read('../app/(main)/settings.tsx');
  const messages = read('../i18n/messages.ts');

  assert.doesNotMatch(config, /staffPortal|cabohealth\.org\/staff/iu);
  assert.doesNotMatch(settings, /settings\.staffAccess|staffPortal|people-circle-outline/iu);
  assert.doesNotMatch(messages, /settings\.staffAccess/iu);
  assert.doesNotMatch(settings, /staff.*(?:tapCount|longPress|PIN)/iu);
});
