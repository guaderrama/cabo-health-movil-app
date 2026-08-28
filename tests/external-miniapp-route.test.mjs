import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicMiniappRoute,
  resolveExternalMiniappRouteState,
} from '../.test-build/features/catalog/publicMiniappRoute.js';

const internal = Object.freeze({
  slug: 'healthy-recipes',
  destinationKind: 'cabohealth',
});
const external = Object.freeze({
  slug: 'external-0123456789abcdef0123456789abcdef',
  destinationKind: 'external_https',
  destinationUrl: 'https://www.eightsleep.com/mx/',
  destinationOrigin: 'https://www.eightsleep.com',
});

test('routes internal and external Public items without serializing an external URL', () => {
  assert.deepEqual(buildPublicMiniappRoute(internal), {
    pathname: '/apps/[slug]',
    params: { slug: internal.slug },
  });

  const route = buildPublicMiniappRoute(external);
  assert.deepEqual(route, {
    pathname: '/external-miniapp/[resourceId]',
    params: { resourceId: external.slug },
  });
  assert.equal(JSON.stringify(route).includes('https://'), false);
});

test('external route waits only for initial catalog load and then fails closed if unavailable', () => {
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: external.slug,
    catalog: [],
    isInitialLoading: true,
  }), { kind: 'loading' });
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: external.slug,
    catalog: [],
    isInitialLoading: false,
  }), { kind: 'unavailable' });
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: external.slug,
    catalog: [external],
    isInitialLoading: false,
  }), { kind: 'ready', miniapp: external });
});

test('external route tears down when the live item is removed or changes destination kind', () => {
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: external.slug,
    catalog: [internal],
    isInitialLoading: false,
  }), { kind: 'unavailable' });
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: external.slug,
    catalog: [{ ...internal, slug: external.slug }],
    isInitialLoading: false,
  }), { kind: 'unavailable' });
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: [external.slug],
    catalog: [external],
    isInitialLoading: true,
  }), { kind: 'unavailable' });
});

test('external route fails closed if an immutable live destination changes while mounted', () => {
  const expectedDestination = {
    resourceId: external.slug,
    destinationUrl: external.destinationUrl,
    destinationOrigin: external.destinationOrigin,
  };
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: external.slug,
    catalog: [external],
    isInitialLoading: false,
    expectedDestination,
  }), { kind: 'ready', miniapp: external });
  assert.deepEqual(resolveExternalMiniappRouteState({
    resourceId: external.slug,
    catalog: [{
      ...external,
      destinationUrl: 'https://www.eightsleep.com/replaced/',
    }],
    isInitialLoading: false,
    expectedDestination,
  }), { kind: 'unavailable' });
});
