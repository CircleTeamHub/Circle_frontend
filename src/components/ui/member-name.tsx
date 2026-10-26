import { memo, useMemo } from 'react';
import {
  Text,
  useColorScheme,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useMemberNameAnimation } from '@/components/ui/member-name-animation';
import { MemberNameFlow } from '@/components/ui/member-name-flow';
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
   * 是否跑流动动画(仅顶档 super 有效)。默认关:列表、会话、消息、朋友圈里一律静态渐变,
   * 只有资料页头部这类「一屏只有一个名字」的地方才显式打开。
   * 打开后外面会多包一层 View(Skia 画布要叠在占位 Text 上),所以不能再嵌进别的 <Text> 里;
   * Skia 只照搬字号、字重、字距、行高、对齐,自定义 fontFamily / textTransform 等不生效。
   * 所在页面切走(tab 切换、上面压了新页面)时动画自动暂停;名字含彩色 emoji 时退回静态渐变。
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
// 卡片上可读,暖调贵气)。仅顶档 super 用这条色带(列表里静态铺开,资料页头部流动);
// 银 / 金 / 钻石均为纯色。
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

// 彩色 emoji 走的是自带颜色的字形:流光用名字字形当遮罩,会把它们涂成一块渐变剪影。
// 不用 \p{Extended_Pictographic}:Hermes 对 Unicode 属性转义的支持没有把握,
// 显式码位区间覆盖杂项符号/装饰符号、⭐⭕、补充平面的表情与旗帜,以及 emoji 变体选择符。
const COLOR_EMOJI = /[\u2600-\u27BF\u2B50\u2B55\uFE0F]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/;

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

/**
 * 按会员档位给用户名加特效的文字组件。非会员 / 拿不到 vipLevel 时退化为普通 <Text>,
 * 可无脑替换现有的 `<Text style={...}>{name}</Text>`(额外传 vipLevel 即可)。
 *
 * 银/金/钻石为纯色;超级(玫瑰金流光)默认静态渐变,animated 时为流动渐变。
 * 流动渐变原生端由已在包里的 Skia 绘制(见 member-name-flow.tsx),不新增原生依赖,
 * 所以 OTA 下发到旧安装包也安全。
 */
export const MemberName = memo(function MemberName({
  name,
  vipLevel,
  userId,
  style,
  numberOfLines,
  animated = false,
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
  const flowing = animated && tier === 'super' && !COLOR_EMOJI.test(name);
  const { progress, reduceMotionEnabled } = useMemberNameAnimation(flowing);

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

  // 所有流动实例共享根节点的动画时钟;静态渐变不注册消费者,时钟不会为它转。
  if (!flowing || reduceMotionEnabled) {
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
    <MemberNameFlow
      name={name}
      colors={colors}
      progress={progress}
      style={style}
      numberOfLines={numberOfLines}
    />
  );
});
