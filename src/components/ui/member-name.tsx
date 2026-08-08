import { memo, useMemo } from 'react';
import {
  Text,
  useColorScheme,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useMemberNameAnimation } from '@/components/ui/member-name-animation';
import {
  getMembershipTierForVipLevel,
  type MembershipTier,
} from '@/features/profile/membership-plans';
import { useUserVipLevel } from '@/stores/userVipStore';

interface MemberNameProps {
  name: string;
  /**
   * 该用户的 vipLevel;0 / null / undefined = 非会员,不加特效。
   */
  vipLevel?: number | null;
  /**
   * 拿不到 vipLevel、只有 userId 的场景（聊天发送者 / 会话列表 / 通讯录 / 通知等 IM/列表）
   * 传它，组件按 userId 从客户端缓存补查 vipLevel（未知触发批量拉取，回来自动重渲染名字亮起）。
   * 能内联提供 vipLevel 时优先传 vipLevel，可省掉这次补查。
   */
  userId?: string | null;
  /** 复用调用处的文字样式(字号/字重/默认色)。特效只覆盖颜色。 */
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /**
   * 是否跑流动动画。默认开。列表里同屏名字很多时可传 false,退化为静态渐变,
   * 避免几十个名字同时逐字动画拖垮性能。
   */
  animated?: boolean;
}

// 银色 / 金色 / 钻石 = 纯色。按主题取变体保证可读:浅色主题白底上用深变体(≥4.8:1),
// 深色主题用亮变体(深底可读)。钻石取纯紫(violet-600 / violet-400),不再走渐变。
const SOLID_COLOR: Record<
  'light' | 'dark',
  Partial<Record<MembershipTier, string>>
> = {
  light: { silver: '#5F6B7A', gold: '#946A00', diamond: '#7C3AED' },
  dark: { silver: '#AEB6C2', gold: '#E7B34D', diamond: '#A78BFA' },
};

// 超级 = 暖调玫瑰金流光(香槟金→玫瑰金→玫瑰粉→藕紫,回文循环无缝,中等饱和度确保浅色
// 卡片上可读,暖调贵气)。仅顶档 super 走逐字流动渐变;银 / 金 / 钻石均为纯色。
const FLOW_COLORS: Record<'super', readonly string[]> = {
  super: [
    '#D9A85E',
    '#DD9576',
    '#D97795',
    '#A96B99',
    '#D97795',
    '#DD9576',
    '#D9A85E',
  ],
};

// 静态渐变(animated=false):把色带沿名字长度均匀铺开,第 index 个字取对应位置的颜色。
function staticColorAt(
  palette: readonly string[],
  index: number,
  length: number,
): string {
  if (length <= 1) {
    return palette[0];
  }
  const ratio = index / (length - 1);
  return palette[Math.round(ratio * (palette.length - 1))];
}

// 单个字符:颜色随全局 progress + 自身位置偏移在色带上循环流动,形成沿名字流走的光。
const FlowChar = memo(function FlowChar({
  char,
  colors,
  progress,
  offset,
}: {
  char: string;
  colors: readonly string[];
  progress: SharedValue<number>;
  offset: number;
}) {
  const inputRange = useMemo(
    () => colors.map((_, i) => i / (colors.length - 1)),
    [colors],
  );
  const animatedStyle = useAnimatedStyle(() => {
    const t = (progress.value + offset) % 1;
    return { color: interpolateColor(t, inputRange, colors as string[]) };
  });
  return <Animated.Text style={animatedStyle}>{char}</Animated.Text>;
});

/**
 * 按会员档位给用户名加特效的文字组件。非会员 / 拿不到 vipLevel 时退化为普通 <Text>,
 * 可无脑替换现有的 `<Text style={...}>{name}</Text>`(额外传 vipLevel 即可)。
 *
 * 银/金/钻石为纯色;超级(玫瑰金流光)为逐字流动渐变,基于已装的 reanimated,
 * 无需 masked-view / linear-gradient 原生依赖,dev client 免重建。
 */
export const MemberName = memo(function MemberName({
  name,
  vipLevel,
  userId,
  style,
  numberOfLines,
  animated = true,
}: MemberNameProps) {
  // 内联优先：显式传入的 vipLevel 直接用，不触发补查。只有拿不到 vipLevel、只有 userId
  // 的场景（聊天/会话/通讯录/通知）才按 userId 从缓存补查（未知触发批量拉取，回来自动亮起）。
  const cachedVipLevel = useUserVipLevel(vipLevel == null ? userId : null);
  const effectiveVipLevel = vipLevel ?? cachedVipLevel;
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const tier =
    effectiveVipLevel != null
      ? getMembershipTierForVipLevel(effectiveVipLevel)
      : null;
  // Array.from 而非 split(''),正确切分 emoji / 代理对,避免半个字符染错色。
  const chars = useMemo(() => Array.from(name), [name]);
  const isFlow = tier === 'super';
  const { progress, reduceMotionEnabled } = useMemberNameAnimation(
    isFlow && animated,
  );

  if (!tier) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {name}
      </Text>
    );
  }

  const solid = SOLID_COLOR[scheme][tier];
  if (solid) {
    return (
      <Text style={[style, { color: solid }]} numberOfLines={numberOfLines}>
        {name}
      </Text>
    );
  }

  const colors = FLOW_COLORS.super;

  // super 顶档流光是会员核心视觉,默认在所有页面(资料/会话/通讯录/朋友圈/通知)都流动。
  // 所有实例共享根节点的动画时钟；animated={false} 仍保留为极端密集列表的可选静态降级。
  if (!animated || reduceMotionEnabled) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {chars.map((ch, index) => (
          <Text
            key={`${index}-${ch}`}
            style={{ color: staticColorAt(colors, index, chars.length) }}
          >
            {ch}
          </Text>
        ))}
      </Text>
    );
  }

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {chars.map((ch, index) => (
        <FlowChar
          key={`${index}-${ch}`}
          char={ch}
          colors={colors}
          progress={progress}
          offset={chars.length > 1 ? index / chars.length : 0}
        />
      ))}
    </Text>
  );
});
