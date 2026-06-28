import { memo, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { SystemIconKey } from '@/types';

type Props = {
  systemKey: SystemIconKey;
  size?: number;
  level?: number;
};

// 5 款 VIP 配色（VIP1→5 递进，宝石色系）；等级超出 1-5 时取最近档。
const VIP_PALETTES: Record<
  number,
  { main: [string, string, string]; top: [string, string]; text: string }
> = {
  1: { main: ['#A8E6A0', '#5DBE5C', '#2E8B43'], top: ['#EAFBE6', '#86D584'], text: '#1E5B2E' },
  2: { main: ['#A8D4FA', '#3B82F6', '#1E5FD9'], top: ['#E6F2FE', '#7CB4F5'], text: '#15407A' },
  3: { main: ['#D4BBF7', '#8B5CF6', '#6526C9'], top: ['#F2EAFE', '#B79BF0'], text: '#4A2299' },
  4: { main: ['#FFE9A8', '#F0B53E', '#B97812'], top: ['#FFF6DC', '#F8CE66'], text: '#7A4E0A' },
  5: { main: ['#FBC2D0', '#F43F8E', '#BE185D'], top: ['#FEECF1', '#F794B6'], text: '#8A1248' },
};

// VIP 徽章：宝石切割钻石 + 白切面线 + 中央等级数字；按 VIP 等级（1-5）切换配色。
function VipIcon({ size, level }: { size: number; level?: number }) {
  const lv = Math.min(Math.max(Math.round(level ?? 1), 1), 5);
  const p = VIP_PALETTES[lv];
  const uid = useId().replace(/:/g, '');
  const bgId = `vip-dia-${lv}-${uid}`;
  const topId = `vip-diatop-${lv}-${uid}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <LinearGradient id={bgId} x1="12" y1="10" x2="52" y2="56">
          <Stop offset="0" stopColor={p.main[0]} />
          <Stop offset="0.5" stopColor={p.main[1]} />
          <Stop offset="1" stopColor={p.main[2]} />
        </LinearGradient>
        <LinearGradient id={topId} x1="18" y1="11" x2="46" y2="26">
          <Stop offset="0" stopColor={p.top[0]} />
          <Stop offset="1" stopColor={p.top[1]} />
        </LinearGradient>
      </Defs>
      <Path d="M19 12 L45 12 L56 26 L32 56 L8 26 Z" fill={`url(#${bgId})`} />
      <Path d="M19 12 L45 12 L50 26 L14 26 Z" fill={`url(#${topId})`} />
      <Path d="M14 26 L50 26" stroke="#FFFFFF" strokeWidth={0.8} opacity={0.5} fill="none" />
      <Path d="M8 26 L56 26" stroke="#FFFFFF" strokeWidth={0.8} opacity={0.4} fill="none" />
      <Path d="M19 12 L26 26 M45 12 L38 26" stroke="#FFFFFF" strokeWidth={0.8} opacity={0.5} fill="none" />
      <Path d="M14 26 L24 44 M50 26 L40 44" stroke="#FFFFFF" strokeWidth={0.7} opacity={0.3} fill="none" />
      <Path d="M8 26 L32 56 M56 26 L32 56" stroke="#FFFFFF" strokeWidth={0.7} opacity={0.3} fill="none" />
      {level != null ? (
        <SvgText
          x="32"
          y="42"
          textAnchor="middle"
          fill={p.text}
          fontSize="19"
          fontWeight="bold"
        >
          {String(level)}
        </SvgText>
      ) : null}
    </Svg>
  );
}

// 新人徽章：绿渐变圆底 + 白色叶子（羽状叶脉、嫩茎），清新有辨识度。
function NewUserIcon({ size }: { size: number }) {
  const bgId = `new-bg-${useId().replace(/:/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <LinearGradient id={bgId} x1="10" y1="8" x2="54" y2="58">
          <Stop offset="0" stopColor="#9BE08F" />
          <Stop offset="0.55" stopColor="#5DBE5C" />
          <Stop offset="1" stopColor="#36A046" />
        </LinearGradient>
      </Defs>
      <Circle cx="32" cy="32" r="30" fill={`url(#${bgId})`} />
      <Circle
        cx="32"
        cy="32"
        r="24.5"
        stroke="#FFFFFF"
        strokeWidth={1.4}
        fill="none"
        opacity={0.4}
      />
      <Path
        d="M28 44 C 23 47 19 48.5 16 50.5"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M20 47.5 L 24.5 46.5 M22.3 44.8 L 22 49.6"
        stroke="#FFFFFF"
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M27 45 C 21.5 33 27.5 19.5 45 15.5 C 46.5 31 41 43 27 45 Z"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M29.5 43 L 42.5 18.5"
        stroke="#FFFFFF"
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M33.5 35.5 L 29 34 M36.5 30 L 32 28.5 M39.5 24.5 L 35 23"
        stroke="#FFFFFF"
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

// 合作达人徽章：蓝渐变八角星底（两枚圆角方形旋转叠加）+ 白色握手，信任专业。
function PartnerIcon({ size }: { size: number }) {
  const handshake = Math.round(size * 0.58);
  const bgId = `partner-bg-${useId().replace(/:/g, '')}`;
  return (
    <View style={[styles.partner, { width: size, height: size }]}>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id={bgId} x1="10" y1="8" x2="54" y2="58">
            <Stop offset="0" stopColor="#7CC0F8" />
            <Stop offset="0.55" stopColor="#3B82F6" />
            <Stop offset="1" stopColor="#2563EB" />
          </LinearGradient>
        </Defs>
        <Rect
          x="10"
          y="10"
          width="44"
          height="44"
          rx="11"
          fill={`url(#${bgId})`}
        />
        <G rotation={45} origin="32, 32">
          <Rect
            x="10.5"
            y="10.5"
            width="43"
            height="43"
            rx="11"
            fill={`url(#${bgId})`}
          />
        </G>
      </Svg>
      <MaterialCommunityIcons name="handshake" size={handshake} color="#FFFFFF" />
    </View>
  );
}

function SystemIconArtComponent({ systemKey, size = 44, level }: Props) {
  if (systemKey === 'VIP') {
    return <VipIcon size={size} level={level} />;
  }

  if (systemKey === 'PARTNER') {
    return <PartnerIcon size={size} />;
  }

  return <NewUserIcon size={size} />;
}

const styles = StyleSheet.create({
  partner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const SystemIconArt = memo(SystemIconArtComponent);
