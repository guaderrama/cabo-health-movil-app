import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  StyleSheet,
  StyleProp,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Line, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { introColors } from '../constants';
import {
  allowsMoleculeMotion,
  createMoleculeLoopController,
  MOLECULE_DRIFT_PLAN,
  RICH_CENTER_PARTICLE_PLAN,
  shouldKeepMoleculeConnection,
  type MoleculeLoopController,
} from '../features/motion/moleculeMotionPolicy';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  colorType: 'dark' | 'medium' | 'light' | 'accent' | 'warm';
}

export interface AnimatedMoleculesProps {
  isDark?: boolean;
  active: boolean;
  reduceMotion: boolean | null;
  density?: 'standard' | 'rich';
  style?: StyleProp<ViewStyle>;
}

// Color palette matching header gradient
const COLORS = {
  light: {
    dark: '#0E5876',
    medium: '#2A9FB3',
    light: '#72D7DF',
    accent: '#19BECC',
    warm: introColors.gold,
    warmLight: '#EBCB82',
  },
  dark: {
    dark: '#8BC7D2',
    medium: '#5AA5B7',
    light: '#B8DDE3',
    accent: '#DEC9AA',
    warm: '#D8AF60',
    warmLight: '#F3D99C',
  }
};

// Generate DNA-style particles distributed across the screen
const generateParticles = (
  width: number,
  height: number,
  density: 'standard' | 'rich',
): Particle[] => {
  const particles: Particle[] = [];
  const colorTypes: Array<'dark' | 'medium' | 'light' | 'accent'> = ['dark', 'medium', 'light', 'accent'];

  // DNA helix-inspired positions on the left side
  const leftHelix = [
    { x: 0.06, y: 160 }, { x: 0.12, y: 200 }, { x: 0.08, y: 240 },
    { x: 0.14, y: 290 }, { x: 0.06, y: 340 }, { x: 0.10, y: 390 },
    { x: 0.04, y: 450 }, { x: 0.12, y: 510 }, { x: 0.08, y: 570 },
    { x: 0.14, y: 630 }, { x: 0.06, y: 690 }, { x: 0.10, y: 750 },
    { x: 0.04, y: 810 },
  ];

  // DNA helix-inspired positions on the right side
  const rightHelix = [
    { x: 0.94, y: 180 }, { x: 0.88, y: 230 }, { x: 0.92, y: 280 },
    { x: 0.86, y: 330 }, { x: 0.94, y: 380 }, { x: 0.90, y: 430 },
    { x: 0.96, y: 490 }, { x: 0.88, y: 550 }, { x: 0.92, y: 610 },
    { x: 0.86, y: 670 }, { x: 0.94, y: 730 }, { x: 0.90, y: 790 },
    { x: 0.96, y: 850 },
  ];

  // Scattered floating particles in the middle (subtle)
  const floatingParticles = [
    { x: 0.25, y: 220 }, { x: 0.75, y: 250 },
    { x: 0.30, y: 400 }, { x: 0.70, y: 450 },
    { x: 0.20, y: 580 }, { x: 0.80, y: 620 },
    { x: 0.35, y: 720 }, { x: 0.65, y: 780 },
    { x: 0.50, y: 350 }, { x: 0.50, y: 550 },
    { x: 0.45, y: 680 }, { x: 0.55, y: 480 },
  ];

  // Small accent particles (very subtle)
  const accentParticles = [
    { x: 0.15, y: 260, size: 2, colorType: 'light' },
    { x: 0.85, y: 300, size: 4.5, colorType: 'warm' },
    { x: 0.18, y: 460, size: 2, colorType: 'light' },
    { x: 0.82, y: 520, size: 2, colorType: 'accent' },
    { x: 0.12, y: 660, size: 2, colorType: 'light' },
    { x: 0.88, y: 720, size: 2, colorType: 'accent' },
    { x: 0.40, y: 300, size: 4, colorType: 'warm' },
    { x: 0.60, y: 600, size: 2, colorType: 'accent' },
  ] as const;

  let id = 1;

  // Add left helix particles (varied sizes)
  leftHelix.forEach((pos, i) => {
    particles.push({
      id: id++,
      x: width * pos.x,
      y: height * (pos.y / 900),
      size: i % 3 === 0 ? 7 : (i % 2 === 0 ? 5 : 4),
      colorType: colorTypes[i % 4],
    });
  });

  // Add right helix particles (varied sizes)
  rightHelix.forEach((pos, i) => {
    particles.push({
      id: id++,
      x: width * pos.x,
      y: height * (pos.y / 900),
      size: i % 3 === 0 ? 6 : (i % 2 === 0 ? 4 : 5),
      colorType: colorTypes[(i + 2) % 4],
    });
  });

  // Add floating particles (smaller, more subtle)
  floatingParticles.forEach((pos, i) => {
    particles.push({
      id: id++,
      x: width * pos.x,
      y: height * (pos.y / 900),
      size: i % 2 === 0 ? 3 : 4,
      colorType: colorTypes[(i + 1) % 4],
    });
  });

  // Add accent particles (smallest, most subtle)
  accentParticles.forEach((pos) => {
    particles.push({
      id: id++,
      x: width * pos.x,
      y: height * (pos.y / 900),
      size: pos.size,
      colorType: pos.colorType,
    });
  });

  if (density === 'rich') {
    const richParticles = [
      { x: 0.02, y: 95 }, { x: 0.18, y: 120 }, { x: 0.34, y: 90 }, { x: 0.68, y: 105 }, { x: 0.83, y: 135 }, { x: 0.98, y: 110 },
      { x: 0.03, y: 315 }, { x: 0.22, y: 350 }, { x: 0.42, y: 270 }, { x: 0.61, y: 330 }, { x: 0.79, y: 370 }, { x: 0.98, y: 300 },
      { x: 0.02, y: 535 }, { x: 0.24, y: 520 }, { x: 0.39, y: 610 }, { x: 0.63, y: 570 }, { x: 0.77, y: 500 }, { x: 0.98, y: 585 },
      { x: 0.03, y: 760 }, { x: 0.21, y: 825 }, { x: 0.39, y: 785 }, { x: 0.59, y: 840 }, { x: 0.78, y: 805 }, { x: 0.98, y: 755 },
    ];
    richParticles.forEach((pos, i) => {
      particles.push({
        id: id++,
        x: width * pos.x,
        y: height * (pos.y / 900),
        size: i % 6 === 0 ? 6 : i % 3 === 0 ? 4 : 2.5,
        colorType: colorTypes[(i + 1) % colorTypes.length],
      });
    });

    RICH_CENTER_PARTICLE_PLAN.forEach((pos, i) => {
      particles.push({
        id: id++,
        x: width * pos.x,
        y: height * (pos.y / 900),
        size: pos.size,
        colorType: pos.warm ? 'warm' : colorTypes[(i + 2) % colorTypes.length],
      });
    });
  }

  return particles;
};

// Generate connections between nearby particles (DNA-style)
const generateConnections = (particles: Particle[]): { from: Particle; to: Particle }[] => {
  const connections: { from: Particle; to: Particle }[] = [];
  const maxDistance = 180;

  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Connect nearby particles, especially vertical neighbors (DNA rungs)
      if (distance < maxDistance) {
        // Prioritize horizontal connections (DNA rungs) and close vertical ones
        const isHorizontalConnection = Math.abs(dy) < 80 && Math.abs(dx) > 50;
        const isVerticalConnection = Math.abs(dx) < 40 && Math.abs(dy) < 100;

        if (isHorizontalConnection || isVerticalConnection) {
          connections.push({ from: particles[i], to: particles[j] });
        }
      }
    }
  }

  return connections.filter((_, index) => shouldKeepMoleculeConnection(index));
};

export const AnimatedMolecules: React.FC<AnimatedMoleculesProps> = ({
  isDark = false,
  active,
  reduceMotion,
  density = 'standard',
  style,
}) => {
  const { width, height } = useWindowDimensions();
  const particles = useMemo(
    () => generateParticles(width, height, density),
    [density, height, width],
  );
  const connections = useMemo(() => generateConnections(particles), [particles]);
  const moleculeLayers = useMemo(() => {
    const groupedParticles = MOLECULE_DRIFT_PLAN.map(() => [] as Particle[]);
    particles.forEach((particle) => {
      groupedParticles[(particle.id - 1) % groupedParticles.length].push(particle);
    });
    return groupedParticles.map((layerParticles, layerIndex) => ({
      particles: layerParticles,
      connections: connections.filter(
        ({ from }) => (from.id - 1) % groupedParticles.length === layerIndex,
      ),
    }));
  }, [connections, particles]);
  const colors = isDark ? COLORS.dark : COLORS.light;
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');

  const driftOne = useRef(new Animated.Value(0)).current;
  const driftTwo = useRef(new Animated.Value(0)).current;
  const driftThree = useRef(new Animated.Value(0)).current;
  const driftValues = useMemo(
    () => [driftOne, driftTwo, driftThree],
    [driftOne, driftTwo, driftThree],
  );
  const loopControllerRef = useRef<MoleculeLoopController | null>(null);

  if (!loopControllerRef.current) {
    loopControllerRef.current = createMoleculeLoopController({
      start() {
        const loop = Animated.parallel(
          MOLECULE_DRIFT_PLAN.map((plan, index) => Animated.loop(
            Animated.sequence([
              Animated.timing(driftValues[index], {
                toValue: 1,
                duration: plan.durationMs,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
              Animated.timing(driftValues[index], {
                toValue: 0,
                duration: plan.durationMs,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
            ]),
          )),
        );
        loop.start();
        return loop;
      },
      stop(loop) {
        loop.stop();
      },
      showStatic() {
        driftValues.forEach((value) => {
          value.stopAnimation();
          value.setValue(0);
        });
      },
    });
  }

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppIsActive(nextState === 'active');
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    loopControllerRef.current?.reconcile(
      allowsMoleculeMotion({ active, appActive: appIsActive, reduceMotion }),
    );
  }, [active, appIsActive, reduceMotion]);

  useEffect(() => {
    const controller = loopControllerRef.current;
    return () => controller?.destroy();
  }, []);

  const animatedLayerStyles = MOLECULE_DRIFT_PLAN.map((plan, index) => ({
    transform: [
      {
        translateX: driftValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [0, plan.translateX],
        }),
      },
      {
        translateY: driftValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [0, plan.translateY],
        }),
      },
    ],
  }));

  const getOpacity = (colorType: string): number => {
    // Dark mode: more visible particles for elegance
    const baseOpacity = isDark ? 0.35 : 0.24;
    switch (colorType) {
      case 'dark': return baseOpacity + 0.12;
      case 'medium': return baseOpacity + 0.08;
      case 'light': return baseOpacity + 0.04;
      case 'accent': return baseOpacity + 0.10;
      case 'warm': return baseOpacity + 0.24;
      default: return baseOpacity;
    }
  };

  return (
    <View
      style={[styles.container, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {moleculeLayers.map((layer, layerIndex) => (
        <Animated.View
          key={`network-layer-${layerIndex}`}
          style={[styles.svgContainer, animatedLayerStyles[layerIndex]]}
        >
          <Svg width={width} height={height} style={styles.svg}>
            <Defs>
              <LinearGradient id="gradientDark" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={colors.dark} />
                <Stop offset="100%" stopColor={colors.medium} />
              </LinearGradient>
              <LinearGradient id="gradientMedium" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={colors.medium} />
                <Stop offset="100%" stopColor={colors.light} />
              </LinearGradient>
              <LinearGradient id="gradientLight" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={colors.light} />
                <Stop offset="100%" stopColor={colors.accent} />
              </LinearGradient>
              <LinearGradient id="gradientAccent" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={colors.accent} />
                <Stop offset="100%" stopColor={colors.light} />
              </LinearGradient>
              <LinearGradient id="gradientWarm" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor={colors.warm} />
                <Stop offset="100%" stopColor={colors.warmLight} />
              </LinearGradient>
            </Defs>

            <G opacity={isDark ? 0.22 : density === 'rich' ? 0.16 : 0.09}>
              {layer.connections.map((connection, index) => (
                <Line
                  key={`line-${layerIndex}-${index}`}
                  x1={connection.from.x}
                  y1={connection.from.y}
                  x2={connection.to.x}
                  y2={connection.to.y}
                  stroke={colors.medium}
                  strokeWidth={0.8}
                />
              ))}
            </G>

            {layer.particles.map((particle) => (
              <G key={`particle-${particle.id}`}>
                {(particle.size >= 6 || (particle.colorType === 'warm' && particle.size >= 4)) && (
                  <Circle
                    cx={particle.x}
                    cy={particle.y}
                    r={particle.size * 2.3}
                    fill={particle.colorType === 'warm' ? colors.warmLight : colors.light}
                    opacity={particle.colorType === 'warm' ? 0.18 : isDark ? 0.08 : 0.11}
                  />
                )}
                <Circle
                  cx={particle.x}
                  cy={particle.y}
                  r={particle.size}
                  fill={`url(#gradient${particle.colorType.charAt(0).toUpperCase() + particle.colorType.slice(1)})`}
                  opacity={getOpacity(particle.colorType)}
                />
              </G>
            ))}
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  svgContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

export default AnimatedMolecules;
