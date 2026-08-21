import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { introColors } from '../constants';
import { useReducedMotion, useTheme } from '../hooks';
import { AnimatedMolecules } from './AnimatedMolecules';

export function BrandedBackground({
  density = 'standard',
  moleculeOpacity = 0.48,
}: {
  density?: 'standard' | 'rich';
  moleculeOpacity?: number;
}) {
  const isFocused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const { colors, isDark } = useTheme();

  return (
    <>
      <LinearGradient
        colors={isDark
          ? [introColors.ink, '#0B3042', colors.cardBackground]
          : [introColors.gradientTop, introColors.gradientMiddle, introColors.gradientBottom]}
        locations={[0, 0.42, 0.92]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <AnimatedMolecules
        active={isFocused}
        density={density}
        isDark={isDark}
        reduceMotion={reduceMotion}
        style={[styles.molecules, { opacity: moleculeOpacity }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  molecules: {
    ...StyleSheet.absoluteFillObject,
  },
});

export default BrandedBackground;
