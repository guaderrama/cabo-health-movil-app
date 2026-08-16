import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Line, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import {
  allowsMoleculeMotion,
  createMoleculeLoopController,
  type MoleculeLoopController,
} from '../features/motion/moleculeMotionPolicy';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  colorType: 'dark' | 'medium' | 'light' | 'accent';
}

export interface AnimatedMoleculesProps {
  isDark?: boolean;
  active: boolean;
  reduceMotion: boolean | null;
  style?: ViewStyle;
}

// Color palette matching header gradient
const COLORS = {
  light: {
    dark: '#0D9488',      // Teal profundo
    medium: '#0891B2',    // Cyan medio
    light: '#22D3EE',     // Cyan claro
    accent: '#0EA5E9',    // Azul cielo
  },
  dark: {
    dark: '#0284C7',      // Azul profundo
    medium: '#0891B2',    // Cyan medio
    light: '#22D3EE',     // Cyan claro
    accent: '#38BDF8',    // Azul claro
  }
};

// Generate DNA-style particles distributed across the screen
const generateParticles = (width: number, height: number): Particle[] => {
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
    { x: 0.15, y: 260 }, { x: 0.85, y: 300 },
    { x: 0.18, y: 460 }, { x: 0.82, y: 520 },
    { x: 0.12, y: 660 }, { x: 0.88, y: 720 },
    { x: 0.40, y: 300 }, { x: 0.60, y: 600 },
  ];

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
  accentParticles.forEach((pos, i) => {
    particles.push({
      id: id++,
      x: width * pos.x,
      y: height * (pos.y / 900),
      size: 2,
      colorType: i % 2 === 0 ? 'light' : 'accent',
    });
  });

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

  return connections;
};

export const AnimatedMolecules: React.FC<AnimatedMoleculesProps> = ({
  isDark = false,
  active,
  reduceMotion,
  style,
}) => {
  const { width, height } = useWindowDimensions();
  const particles = useMemo(() => generateParticles(width, height), [height, width]);
  const connections = useMemo(() => generateConnections(particles), [particles]);
  const colors = isDark ? COLORS.dark : COLORS.light;
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');

  const floatAnim = useRef(new Animated.Value(0)).current;
  const loopControllerRef = useRef<MoleculeLoopController | null>(null);

  if (!loopControllerRef.current) {
    loopControllerRef.current = createMoleculeLoopController({
      start() {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(floatAnim, {
              toValue: 1,
              duration: 5000,
              useNativeDriver: true,
            }),
            Animated.timing(floatAnim, {
              toValue: 0,
              duration: 5000,
              useNativeDriver: true,
            }),
          ]),
        );
        loop.start();
        return loop;
      },
      stop(loop) {
        loop.stop();
      },
      showStatic() {
        floatAnim.stopAnimation();
        floatAnim.setValue(0);
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

  const animatedStyle = {
    transform: [
      {
        translateY: floatAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 8], // Subtle movement
        }),
      },
    ],
  };

  const getOpacity = (colorType: string): number => {
    // Dark mode: more visible particles for elegance
    const baseOpacity = isDark ? 0.35 : 0.18;
    switch (colorType) {
      case 'dark': return baseOpacity + 0.12;
      case 'medium': return baseOpacity + 0.08;
      case 'light': return baseOpacity + 0.04;
      case 'accent': return baseOpacity + 0.10;
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
      <Animated.View style={[styles.svgContainer, animatedStyle]}>
        <Svg width={width} height={height} style={styles.svg}>
          <Defs>
            {/* Gradient definitions for different color intensities */}
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
          </Defs>

          {/* Connection lines (DNA rungs style) */}
          <G opacity={isDark ? 0.2 : 0.06}>
            {connections.map((conn, index) => (
              <Line
                key={`line-${index}`}
                x1={conn.from.x}
                y1={conn.from.y}
                x2={conn.to.x}
                y2={conn.to.y}
                stroke={colors.medium}
                strokeWidth={0.8}
              />
            ))}
          </G>

          {/* Particles with varied colors */}
          {particles.map((particle) => (
            <Circle
              key={`particle-${particle.id}`}
              cx={particle.x}
              cy={particle.y}
              r={particle.size}
              fill={`url(#gradient${particle.colorType.charAt(0).toUpperCase() + particle.colorType.slice(1)})`}
              opacity={getOpacity(particle.colorType)}
            />
          ))}
        </Svg>
      </Animated.View>
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
    flex: 1,
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

export default AnimatedMolecules;
