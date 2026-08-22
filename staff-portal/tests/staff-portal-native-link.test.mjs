import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('Settings visibly opens the exact Staff Portal URL in the system browser', () => {
  const config = read('../constants/config.ts');
  const settings = read('../app/(main)/settings.tsx');
  const messages = read('../i18n/messages.ts');

  assert.match(config, /staffPortal:\s*'https:\/\/cabohealth\.org\/staff\/'/u);
  assert.match(settings, /t\('settings\.staffAccess'\)/u);
  assert.match(settings, /t\('settings\.staffAccessSubtitle'\)/u);
  assert.match(settings, /Linking\.openURL\(config\.urls\.staffPortal\)/u);
  assert.match(settings, /icon="people-circle-outline"/u);
  assert.match(messages, /'settings\.staffAccess': 'Staff Access'/u);
  assert.match(messages, /'settings\.staffAccess': 'Acceso del personal'/u);
  assert.doesNotMatch(settings, /staff.*(?:tapCount|longPress|PIN)/iu);
});
