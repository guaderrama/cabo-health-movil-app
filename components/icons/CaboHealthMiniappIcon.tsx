import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '../../hooks';

export type CaboHealthMiniappIconName =
  | 'flask-outline'
  | 'book-outline'
  | 'leaf-outline'
  | 'restaurant-outline'
  | 'heart-outline'
  | 'map-outline'
  | 'chatbubble-ellipses-outline'
  | 'sparkles-outline';

interface IconDrawingProps {
  primary: string;
  secondary: string;
  accent: string;
}

const commonStroke = {
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.65,
};

function FlaskIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="M9 3h6M10 3v5l-5.2 8.6A2.9 2.9 0 0 0 7.3 21h9.4a2.9 2.9 0 0 0 2.5-4.4L14 8V3" />
      <Path {...commonStroke} stroke={secondary} d="M7.2 16h9.6M8.6 13.6c1 .7 2 .7 3 0s2-.7 3 0" />
      <Circle cx="14.8" cy="17.7" r="1" fill={accent} />
      <Circle cx="12.2" cy="11" r="0.65" fill={accent} />
    </>
  );
}

function BookIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="M4.5 5.2c2.8-.8 5.3-.2 7.5 1.8v13c-2.2-2-4.7-2.6-7.5-1.8zM19.5 5.2c-2.8-.8-5.3-.2-7.5 1.8v13c2.2-2 4.7-2.6 7.5-1.8z" />
      <Path {...commonStroke} stroke={secondary} d="M7 9c1.2 0 2.2.3 3 .9M17 9c-1.2 0-2.2.3-3 .9M7 12c1.2 0 2.2.3 3 .9" />
      <Path d="M16.9 5.1v5.1l-1.25-.9-1.25.9V6" fill={accent} opacity={0.9} />
    </>
  );
}

function LeafIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="M20 4.2C13.5 4.1 7.1 6.8 5.3 12c-1.3 3.6.7 6.9 4.5 7.1C15 19.4 19.2 13.7 20 4.2Z" />
      <Path {...commonStroke} stroke={secondary} d="M4 21c2.4-5.6 6.2-9.5 12.2-12.6M9.1 15.1l.2-4.2M11.9 12.2l3.8.5" />
      <Circle cx="17.6" cy="6.6" r="1.05" fill={accent} />
    </>
  );
}

function RestaurantIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="M6 3v7M3.8 3v4.2C3.8 9 4.8 10 6 10s2.2-1 2.2-2.8V3M6 10v11M16.8 3c-2.3 1.5-3.6 4.2-3.2 7.2.2 1.5 1.1 2.4 2.3 2.5V21M16.8 3v18" />
      <Path {...commonStroke} stroke={secondary} d="M11.2 17.6c1.7-1 3.7-1 5.6 0" />
      <Circle cx="18.6" cy="6" r="1" fill={accent} />
    </>
  );
}

function HeartIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="M12 20.4 4.7 13.3C.9 9.6 3.2 3.6 7.9 3.6c1.8 0 3.3.9 4.1 2.4.8-1.5 2.3-2.4 4.1-2.4 4.7 0 7 6 3.2 9.7z" />
      <Path {...commonStroke} stroke={secondary} d="M5.4 12h3l1.4-3.1 2.4 6.1 1.8-3h4.5" />
      <Circle cx="18.4" cy="6.2" r="1" fill={accent} />
    </>
  );
}

function MapIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="m3.5 5.8 5.4-2.2 6.2 2.2 5.4-2.2v14.6l-5.4 2.2-6.2-2.2-5.4 2.2zM8.9 3.6v14.6M15.1 5.8v14.6" />
      <Path {...commonStroke} stroke={secondary} d="M6 15.6c2.4-3.4 5.1-4.3 8.3-2.5" />
      <Circle cx="16.6" cy="9" r="2" fill={accent} opacity={0.92} />
      <Circle cx="16.6" cy="9" r="0.65" fill={primary} />
    </>
  );
}

function ChatIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="M4 5.1h16v11.6H9.2L5.3 20v-3.3H4z" />
      <Path {...commonStroke} stroke={secondary} d="M7.5 9.1h9M7.5 12.5h5.8" />
      <Circle cx="17.2" cy="12.5" r="1.05" fill={accent} />
    </>
  );
}

function SparklesIcon({ primary, secondary, accent }: IconDrawingProps) {
  return (
    <>
      <Path {...commonStroke} stroke={primary} d="m10.3 3.5 1.4 4.1 4.1 1.4-4.1 1.4-1.4 4.1-1.4-4.1L4.8 9l4.1-1.4z" />
      <Path {...commonStroke} stroke={secondary} d="m17.8 12.8.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z" />
      <Circle cx="5.2" cy="17.8" r="1.35" fill={accent} />
      <Circle cx="18.5" cy="5.4" r="0.8" fill={accent} />
    </>
  );
}

const drawings: Record<CaboHealthMiniappIconName, (props: IconDrawingProps) => React.JSX.Element> = {
  'flask-outline': FlaskIcon,
  'book-outline': BookIcon,
  'leaf-outline': LeafIcon,
  'restaurant-outline': RestaurantIcon,
  'heart-outline': HeartIcon,
  'map-outline': MapIcon,
  'chatbubble-ellipses-outline': ChatIcon,
  'sparkles-outline': SparklesIcon,
};

export function CaboHealthMiniappIcon({
  name,
  size = 28,
  inverted = false,
  primaryColor,
  secondaryColor,
  accentColor,
}: {
  name: CaboHealthMiniappIconName;
  size?: number;
  inverted?: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
}) {
  const { colors } = useTheme();
  const Drawing = drawings[name];
  const primary = primaryColor ?? (inverted ? colors.onPrimary : colors.primary);
  const secondary = secondaryColor ?? (inverted ? colors.accentLight : colors.primaryLight);
  const accent = accentColor ?? (inverted ? colors.accentLight : colors.accent);

  return (
    <Svg
      accessible={false}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <G>
        <Drawing primary={primary} secondary={secondary} accent={accent} />
      </G>
    </Svg>
  );
}

export default CaboHealthMiniappIcon;
