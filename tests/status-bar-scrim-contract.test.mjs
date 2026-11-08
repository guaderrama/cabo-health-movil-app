import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('scrolling tab screens keep content out from under the status bar', () => {
  // App Review's 3.0 (14) capture showed "MINI APPS" drawn over the clock.
  const scrim = read('components/StatusBarScrim.tsx');
  assert.match(scrim, /position: 'absolute', top: 0/u);
  assert.match(scrim, /height: insets\.top/u);
  assert.match(scrim, /pointerEvents="none"/u);
  for (const screen of ['app/(main)/index.tsx', 'app/(main)/saved.tsx', 'app/(main)/settings.tsx']) {
    assert.match(read(screen), /<\/ScrollView>\s*<StatusBarScrim \/>/u, screen);
  }
});

test('client access copy describes a free invitation, not an included or paid service', () => {
  const messages = read('i18n/messages.ts');
  assert.doesNotMatch(messages, /included with your in-person services|servicios presenciales|with your client services|servicios como cliente/u);
  assert.match(messages, /Free access by personal CaboHealth invitation\. It is not sold, and no purchase grants it\./u);
  assert.match(messages, /Acceso gratuito por invitación personal de CaboHealth\. No se vende ni lo otorga ninguna compra\./u);
});
