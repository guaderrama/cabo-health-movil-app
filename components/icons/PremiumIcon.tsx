// components/icons/PremiumIcon.tsx
// Premium SVG icons with gradient fill - CaboHealth Science & Longevity theme
// Consolidated to 6 core scientific icons with dark mode glow effect

import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop, Circle, G, Rect } from 'react-native-svg';

interface IconProps {
  size?: number;
  isDark?: boolean; // For glow effect in dark mode
}

// Premium gradient definition - Light mode (matches header)
const GradientDefLight = () => (
  <Defs>
    <LinearGradient id="premiumGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <Stop offset="0%" stopColor="#0D9488" />
      <Stop offset="50%" stopColor="#0891B2" />
      <Stop offset="100%" stopColor="#0284C7" />
    </LinearGradient>
  </Defs>
);

// Premium gradient definition - Dark mode with glow effect
const GradientDefDark = () => (
  <Defs>
    <LinearGradient id="premiumGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <Stop offset="0%" stopColor="#38BDF8" />
      <Stop offset="50%" stopColor="#22D3EE" />
      <Stop offset="100%" stopColor="#14B8A6" />
    </LinearGradient>
    <LinearGradient id="glowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <Stop offset="0%" stopColor="#38BDF8" stopOpacity="0.4" />
      <Stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.2" />
    </LinearGradient>
  </Defs>
);

// Dynamic gradient component
const GradientDef = ({ isDark }: { isDark?: boolean }) => (
  isDark ? <GradientDefDark /> : <GradientDefLight />
);

// Icon name type for TypeScript - Consolidated to 6 core icons
export type PremiumIconName =
  | 'dna'         // Longevity/Genetics
  | 'cell'        // Cellular Regeneration
  | 'brain'       // Neuroscience/Cognitive
  | 'molecule'    // Microbiome/Nutrition
  | 'analytics'   // Data/Metrics
  | 'heartPulse'; // Cardiovascular/Fitness

// DNA - Double helix (most iconic for longevity)
const DnaIcon = ({ size = 40, isDark }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <GradientDef isDark={isDark} />
    {/* Glow background for dark mode */}
    {isDark && (
      <Circle cx="12" cy="12" r="10" fill="url(#glowGradient)" opacity={0.3} />
    )}
    <Path
      d="M6 3c0 4 3 6 6 6s6 2 6 6"
      stroke="url(#premiumGradient)"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <Path
      d="M18 3c0 4-3 6-6 6s-6 2-6 6"
      stroke="url(#premiumGradient)"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <Path
      d="M6 15c0 4 3 6 6 6M18 15c0 4-3 6-6 6"
      stroke="url(#premiumGradient)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity={0.7}
    />
    {/* DNA rungs - more elegant thin lines */}
    <Path
      d="M8 5h8M7 9h10M7 15h10M8 19h8"
      stroke="url(#premiumGradient)"
      strokeWidth="1"
      strokeLinecap="round"
      opacity={0.5}
    />
  </Svg>
);

// Cell - Cellular structure for rejuvenation
const CellIcon = ({ size = 40, isDark }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <GradientDef isDark={isDark} />
    {/* Glow background for dark mode */}
    {isDark && (
      <Circle cx="12" cy="12" r="10" fill="url(#glowGradient)" opacity={0.25} />
    )}
    {/* Outer membrane */}
    <Circle cx="12" cy="12" r="9" stroke="url(#premiumGradient)" strokeWidth="1" opacity={0.4} />
    {/* Inner structure */}
    <Circle cx="12" cy="12" r="6" stroke="url(#premiumGradient)" strokeWidth="1" opacity={0.6} />
    {/* Nucleus */}
    <Circle cx="12" cy="12" r="3" fill="url(#premiumGradient)" />
    {/* Organelles */}
    <Circle cx="8" cy="8" r="1.2" fill="url(#premiumGradient)" opacity={0.7} />
    <Circle cx="16" cy="16" r="0.8" fill="url(#premiumGradient)" opacity={0.6} />
    <Circle cx="15" cy="8" r="0.6" fill="url(#premiumGradient)" opacity={0.5} />
    <Circle cx="8" cy="15" r="0.5" fill="url(#premiumGradient)" opacity={0.5} />
  </Svg>
);

// Brain - Stylized brain for cognitive longevity
const BrainIcon = ({ size = 40, isDark }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <GradientDef isDark={isDark} />
    {/* Glow background for dark mode */}
    {isDark && (
      <Circle cx="12" cy="12" r="10" fill="url(#glowGradient)" opacity={0.25} />
    )}
    <Path
      d="M12 4C8 4 5 7 5 10c0 1.5.5 2.8 1.3 3.8-.3.7-.5 1.4-.5 2.2 0 2.2 1.8 4 4 4h.2c.5 1.2 1.7 2 3 2s2.5-.8 3-2h.2c2.2 0 4-1.8 4-4 0-.8-.2-1.5-.5-2.2.8-1 1.3-2.3 1.3-3.8 0-3-3-6-7-6z"
      fill="url(#premiumGradient)"
    />
    {/* Neural pathways - thin elegant lines */}
    <Path
      d="M12 4v16M9 8c-1 0-2 .5-2 1.5s1 1.5 2 1.5M15 8c1 0 2 .5 2 1.5s-1 1.5-2 1.5M9 14c-1 0-1.5.5-1.5 1M15 14c1 0 1.5.5 1.5 1"
      stroke={isDark ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.5)"}
      strokeWidth="0.8"
      strokeLinecap="round"
    />
  </Svg>
);

// Molecule - Molecular structure for microbiome/nutrition
const MoleculeIcon = ({ size = 40, isDark }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <GradientDef isDark={isDark} />
    {/* Glow background for dark mode */}
    {isDark && (
      <Circle cx="12" cy="12" r="10" fill="url(#glowGradient)" opacity={0.25} />
    )}
    {/* Main atoms */}
    <Circle cx="12" cy="6" r="2" fill="url(#premiumGradient)" />
    <Circle cx="6" cy="16" r="2" fill="url(#premiumGradient)" />
    <Circle cx="18" cy="16" r="2" fill="url(#premiumGradient)" />
    {/* Central atom */}
    <Circle cx="12" cy="12" r="1.5" fill="url(#premiumGradient)" opacity={0.7} />
    {/* Bonds - thin elegant lines */}
    <Path
      d="M12 8v2.5M9.5 14l-2-2.5M14.5 14l2-2.5"
      stroke="url(#premiumGradient)"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Secondary bonds */}
    <Path
      d="M8 16h8"
      stroke="url(#premiumGradient)"
      strokeWidth="1"
      strokeLinecap="round"
      opacity={0.5}
    />
  </Svg>
);

// Analytics - Health metrics/data visualization
const AnalyticsIcon = ({ size = 40, isDark }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <GradientDef isDark={isDark} />
    {/* Glow background for dark mode */}
    {isDark && (
      <Circle cx="12" cy="12" r="10" fill="url(#glowGradient)" opacity={0.2} />
    )}
    {/* Chart bars */}
    <Rect x="4" y="14" width="3" height="6" rx="1" fill="url(#premiumGradient)" opacity={0.5} />
    <Rect x="10.5" y="10" width="3" height="10" rx="1" fill="url(#premiumGradient)" opacity={0.7} />
    <Rect x="17" y="6" width="3" height="14" rx="1" fill="url(#premiumGradient)" />
    {/* Trend line - thin elegant */}
    <Path
      d="M4 11l4-2.5 5 1.5 6-4.5"
      stroke="url(#premiumGradient)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Peak indicator */}
    <Circle cx="19" cy="5.5" r="1.5" fill="url(#premiumGradient)" />
  </Svg>
);

// Heart Pulse - Cardiovascular/fitness with ECG line
const HeartPulseIcon = ({ size = 40, isDark }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <GradientDef isDark={isDark} />
    {/* Glow background for dark mode */}
    {isDark && (
      <Circle cx="12" cy="12" r="10" fill="url(#glowGradient)" opacity={0.2} />
    )}
    {/* Heart background - subtle */}
    <Path
      d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
      fill="url(#premiumGradient)"
      opacity={0.25}
    />
    {/* ECG line - the main focus */}
    <Path
      d="M2 13h4l1.5-3 2.5 6 2-3h10"
      stroke="url(#premiumGradient)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Icon map for dynamic rendering - only 6 core icons
const iconComponents: Record<PremiumIconName, React.FC<IconProps>> = {
  dna: DnaIcon,
  cell: CellIcon,
  brain: BrainIcon,
  molecule: MoleculeIcon,
  analytics: AnalyticsIcon,
  heartPulse: HeartPulseIcon,
};

// Main component
interface PremiumIconProps extends IconProps {
  name: PremiumIconName;
}

export function PremiumIcon({ name, size = 40, isDark = false }: PremiumIconProps) {
  const IconComponent = iconComponents[name];
  if (!IconComponent) {
    console.warn(`PremiumIcon: Unknown icon name "${name}"`);
    return null;
  }
  return <IconComponent size={size} isDark={isDark} />;
}

// Export individual icons for direct use
export {
  DnaIcon,
  CellIcon,
  BrainIcon,
  MoleculeIcon,
  AnalyticsIcon,
  HeartPulseIcon,
};

export default PremiumIcon;
