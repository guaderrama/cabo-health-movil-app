import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { resolveReducedMotion } from '../features/motion/moleculeMotionPolicy';

export function useReducedMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    resolveReducedMotion(() => AccessibilityInfo.isReduceMotionEnabled())
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
