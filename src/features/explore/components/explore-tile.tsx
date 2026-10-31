import { useId, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Badge } from '@/components/ui/badge';
import { Radius, Spacing, useTheme, withAlpha } from '@/theme';

// 磁贴画布坐标系（≈ 手机上整行宽度 × 高度），插画按这套坐标画。
// 磁贴按同一宽高比铺开，插画与名字的相对位置始终不变。
const VIEW_W = 345;
const VIEW_H = 96;
// 插画从这条线往右探出；名字止于它左侧，长名字折行也不压到插画。
const ART_LEFT = 196;

const s = StyleSheet.create({
  shell: {
    width: '100%',
    aspectRatio: VIEW_W / VIEW_H,
    borderRadius: Radius.xxl,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 6,
  },
  shellPressed: {
    transform: [{ scale: 0.97 }],
  },
  // 外层留给投影（不能裁剪），内层负责圆角裁切。
  clip: {
    flex: 1,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  footer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: Spacing.lg,
    right: `${((VIEW_W - ART_LEFT) / VIEW_W) * 100}%`,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: 0.3,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

interface ExploreTileProps {
  title: string;
  gradient: readonly [string, string];
  /** 画布坐标系里的 SVG 插画（见 explore-tile-art）。 */
  art: ReactNode;
  badgeCount?: number;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/** 探索页入口磁贴：糖果渐变底 + 右侧探出的贴纸插画，左侧只写名字。 */
export function ExploreTile({
  title,
  gradient,
  art,
  badgeCount = 0,
  accessibilityLabel,
  onPress,
  testID,
}: ExploreTileProps) {
  const { colors, resolvedMode } = useTheme();
  // 同屏两块 SVG：渐变 id 必须各自唯一（Web 端 id 是全局的）。
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const white = colors.white;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        s.shell,
        {
          shadowColor: gradient[0],
          shadowOpacity: resolvedMode === 'dark' ? 0.6 : 0.35,
        },
        pressed && s.shellPressed,
      ]}
    >
      <View style={[s.clip, { borderColor: withAlpha(white, 0.35) }]}>
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid slice"
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <LinearGradient id={`base${uid}`} x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={gradient[0]} />
              <Stop offset="1" stopColor={gradient[1]} />
            </LinearGradient>
            {/* 右上角一团亮光托住插画，左侧留给名字。 */}
            <RadialGradient id={`glow${uid}`} gradientUnits="userSpaceOnUse" cx={VIEW_W} cy={0} r={200}>
              <Stop offset="0" stopColor={white} stopOpacity={0.28} />
              <Stop offset="1" stopColor={white} stopOpacity={0} />
            </RadialGradient>
            {/* 顶部糖果高光。 */}
            <LinearGradient id={`sheen${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={white} stopOpacity={0.28} />
              <Stop offset="0.45" stopColor={white} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width={VIEW_W} height={VIEW_H} fill={`url(#base${uid})`} />
          <Rect width={VIEW_W} height={VIEW_H} fill={`url(#glow${uid})`} />
          {art}
          <Rect width={VIEW_W} height={VIEW_H} fill={`url(#sheen${uid})`} />
        </Svg>
        <View style={s.footer}>
          <Text
            style={[s.title, { color: white, textShadowColor: withAlpha(colors.black, 0.18) }]}
            numberOfLines={2}
          >
            {title}
          </Text>
          <Badge count={badgeCount} />
        </View>
      </View>
    </Pressable>
  );
}
