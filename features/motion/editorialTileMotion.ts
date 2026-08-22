export const EDITORIAL_TILE_MOTION = Object.freeze({
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

export interface EditorialTileEntrance {
  animate: boolean;
  delayMs: number;
  opacity: number;
  translateY: number;
}

export function resolveEditorialTileEntrance({
  index,
  reduceMotion,
}: {
  index: number;
  reduceMotion: boolean;
}): EditorialTileEntrance {
  if (reduceMotion) {
    return { animate: false, delayMs: 0, opacity: 1, translateY: 0 };
  }
  const safeIndex = Number.isInteger(index) && index >= 0 ? Math.min(index, 3) : 0;
  return {
    animate: true,
    delayMs: safeIndex * EDITORIAL_TILE_MOTION.entranceStaggerMs,
    opacity: EDITORIAL_TILE_MOTION.entranceOpacity,
    translateY: EDITORIAL_TILE_MOTION.entranceTravelY,
  };
}
