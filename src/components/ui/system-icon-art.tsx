import { memo } from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

type SystemIconKey = 'VIP' | 'NEW_USER';

type Props = {
  systemKey: SystemIconKey;
  size?: number;
};

function VipIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <LinearGradient id="vip-bg" x1="10" y1="8" x2="54" y2="58">
          <Stop offset="0" stopColor="#FFF3C2" />
          <Stop offset="0.45" stopColor="#F9C85B" />
          <Stop offset="1" stopColor="#B97812" />
        </LinearGradient>
        <LinearGradient id="vip-core" x1="20" y1="18" x2="44" y2="46">
          <Stop offset="0" stopColor="#FFF9E8" />
          <Stop offset="1" stopColor="#F4C14D" />
        </LinearGradient>
      </Defs>
      <Circle cx="32" cy="32" r="30" fill="url(#vip-bg)" />
      <Circle cx="32" cy="32" r="25.5" fill="#5B3A06" fillOpacity="0.14" />
      <Circle cx="32" cy="32" r="22.5" fill="#FFFCF0" fillOpacity="0.2" />
      <Path
        d="M20 42L24.4 22.8L32 29.2L39.6 22.8L44 42H20Z"
        fill="url(#vip-core)"
      />
      <Path
        d="M24.8 25.5L18.5 18.5C18 17.9 18.2 17 19 16.8L24.8 15.5L28.3 10.4C28.8 9.7 29.9 9.7 30.3 10.4L32 12.9L33.7 10.4C34.1 9.7 35.2 9.7 35.7 10.4L39.2 15.5L45 16.8C45.8 17 46 17.9 45.5 18.5L39.2 25.5"
        fill="#FFF8DC"
      />
      <Path
        d="M32 22L34.6 27.2L40.4 28.1L36.2 32.2L37.2 38L32 35.3L26.8 38L27.8 32.2L23.6 28.1L29.4 27.2L32 22Z"
        fill="#B97812"
      />
      <Ellipse cx="25" cy="17.2" rx="2.1" ry="1.4" fill="#FFFFFF" fillOpacity="0.7" />
      <Ellipse cx="39.5" cy="14.6" rx="3.2" ry="1.8" fill="#FFFFFF" fillOpacity="0.45" />
    </Svg>
  );
}

function NewUserIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <LinearGradient id="new-bg" x1="8" y1="10" x2="54" y2="58">
          <Stop offset="0" stopColor="#D9FBFF" />
          <Stop offset="0.45" stopColor="#55D8FF" />
          <Stop offset="1" stopColor="#0E6BFF" />
        </LinearGradient>
        <LinearGradient id="new-core" x1="20" y1="18" x2="42" y2="44">
          <Stop offset="0" stopColor="#FDFEFF" />
          <Stop offset="1" stopColor="#BDE8FF" />
        </LinearGradient>
      </Defs>
      <Circle cx="32" cy="32" r="30" fill="url(#new-bg)" />
      <Circle cx="32" cy="32" r="23.5" fill="#073C9B" fillOpacity="0.14" />
      <Path
        d="M22.5 38.4C23 31.6 27.1 26.4 33.8 22.6L40.7 18.7C41.9 18 43.4 19.1 43 20.4L40.8 28L47.2 34.1C48.2 35.1 47.5 36.9 46.1 36.9H38.4L34.3 44.3C33.6 45.4 32 45.5 31.3 44.4L28.6 40.2L22.5 38.4Z"
        fill="url(#new-core)"
      />
      <Path
        d="M34.9 24.7L40.6 21.4L38.3 29.2C38.2 29.6 38.3 30 38.6 30.3L43.7 35.1H37.5C37 35.1 36.5 35.4 36.3 35.8L32.9 41.8L29.9 37.2C29.6 36.8 29.3 36.5 28.8 36.4L24.8 35.3C25.8 31.3 28.6 28.2 34.9 24.7Z"
        fill="#0C55CB"
      />
      <G fill="#FDFEFF">
        <Circle cx="20" cy="21" r="1.8" />
        <Circle cx="17" cy="27" r="1.2" />
        <Circle cx="45.2" cy="18.5" r="1.5" />
      </G>
      <Path
        d="M15.8 39.8L18.2 35.7L20.6 39.8L24.9 42.2L20.6 44.5L18.2 48.6L15.8 44.5L11.5 42.2L15.8 39.8Z"
        fill="#FDFEFF"
        fillOpacity="0.92"
      />
    </Svg>
  );
}

function SystemIconArtComponent({ systemKey, size = 44 }: Props) {
  if (systemKey === 'VIP') {
    return <VipIcon size={size} />;
  }

  return <NewUserIcon size={size} />;
}

export const SystemIconArt = memo(SystemIconArtComponent);
