import assert from 'node:assert/strict';
import test from 'node:test';

import { STAFF_MESSAGES } from '../.test-build/i18n/messages.js';

test('the staff portal has the same complete contract in English and Mexican Spanish', () => {
  const enKeys = Object.keys(STAFF_MESSAGES.en).sort();
  const esKeys = Object.keys(STAFF_MESSAGES['es-MX']).sort();

  assert.deepEqual(esKeys, enKeys);
  assert.ok(enKeys.length >= 45);
  for (const key of enKeys) {
    assert.notEqual(STAFF_MESSAGES.en[key].trim(), '');
    assert.notEqual(STAFF_MESSAGES['es-MX'][key].trim(), '');
  }
  assert.equal(STAFF_MESSAGES.en['drafts.reviewGate'], 'Draft only. Release review is required before it can appear in the app.');
  assert.equal(STAFF_MESSAGES['es-MX']['drafts.reviewGate'], 'Sólo borrador. Requiere revisión de lanzamiento antes de aparecer en la app.');
  assert.match(STAFF_MESSAGES.en['miniapps.immediate'], /published immediately/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.immediate'], /publican inmediatamente/u);
  assert.match(STAFF_MESSAGES.en['miniapps.immediate'], /titles and summaries are visible to everyone as locked previews/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.immediate'], /títulos y descripciones son visibles para todos como vistas previas con candado/u);
  assert.match(STAFF_MESSAGES.en['miniapps.immediate'], /links and content stay protected/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.immediate'], /enlaces y contenido permanecen protegidos/u);
  assert.match(STAFF_MESSAGES.en['miniapps.immediate'], /Do not place links, private paths, access codes, prices, or purchase\/subscription wording/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.immediate'], /No pongas enlaces, rutas privadas, códigos de acceso, precios ni lenguaje de compra o suscripción/u);
  assert.match(STAFF_MESSAGES.en['miniapps.appleRule'], /no user-generated content, digital purchases, new native permissions or APIs/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.appleRule'], /sin contenido generado por usuarios, compras digitales, permisos o API nativas nuevas/u);
  assert.equal(STAFF_MESSAGES.en['miniapps.url'], 'HTTPS link');
  assert.equal(STAFF_MESSAGES['es-MX']['miniapps.url'], 'Enlace HTTPS');
  assert.match(STAFF_MESSAGES.en['miniapps.externalWarning'], /does not make a public third-party site private/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.externalWarning'], /no vuelve privado/u);
  assert.match(STAFF_MESSAGES.en['miniapps.externalWarning'], /display and distribution rights/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.externalWarning'], /derechos de exhibición y distribución/u);
  assert.match(STAFF_MESSAGES.en['miniapps.createActiveHelp'], /build 8/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.createActiveHelp'], /build 8/u);
  assert.match(STAFF_MESSAGES.en['miniapps.urlInvalid'], /safe public HTTPS/u);
  assert.match(STAFF_MESSAGES['es-MX']['miniapps.urlInvalid'], /HTTPS público seguro/u);
  assert.doesNotMatch(STAFF_MESSAGES.en['miniapps.appleRule'], /CaboHealth-authored only/u);
  assert.doesNotMatch(STAFF_MESSAGES['es-MX']['miniapps.appleRule'], /sólo contenido creado por CaboHealth/u);
  assert.equal(STAFF_MESSAGES.en['audit.action.miniappDeleted'], 'Miniapp deleted');
  assert.equal(STAFF_MESSAGES['es-MX']['audit.action.miniappDeleted'], 'Miniapp eliminada');
});
