import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EDITORIAL_TILE_MOTION,
  resolveEditorialTileEntrance,
} from '../.test-build/features/motion/editorialTileMotion.js';

test('editorial tile motion stays inside the frequent-action budget', () => {
  assert.deepEqual(EDITORIAL_TILE_MOTION, {
    entranceDurationMs: 190,
    entranceStaggerMs: 35,
    entranceTravelY: 6,
    entranceOpacity: 0.96,
    pressInDurationMs: 90,
    pressOutDurationMs: 120,
    pressedScale: 0.985,
    favoriteDurationMs: 170,
    favoriteScale: 1.12,
  });
});

test('entrance remains readable, bounded, and becomes static for reduced motion', () => {
  assert.deepEqual(resolveEditorialTileEntrance({ index: 0, reduceMotion: false }), {
    animate: true,
    delayMs: 0,
    opacity: 0.96,
    translateY: 6,
  });
  assert.deepEqual(resolveEditorialTileEntrance({ index: 2, reduceMotion: false }), {
    animate: true,
    delayMs: 70,
    opacity: 0.96,
    translateY: 6,
  });
  assert.deepEqual(resolveEditorialTileEntrance({ index: 999, reduceMotion: false }), {
    animate: true,
    delayMs: 105,
    opacity: 0.96,
    translateY: 6,
  });
  assert.deepEqual(resolveEditorialTileEntrance({ index: 1, reduceMotion: true }), {
    animate: false,
    delayMs: 0,
    opacity: 1,
    translateY: 0,
  });
});

test('invalid tile indices fail closed to the first position', () => {
  for (const index of [-1, 1.5, Number.NaN]) {
    assert.equal(resolveEditorialTileEntrance({ index, reduceMotion: false }).delayMs, 0);
  }
});
