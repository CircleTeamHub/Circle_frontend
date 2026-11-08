import { memo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';
import {
  getSystemBadgeAsset,
  getSystemBadgeArtBox,
} from './user-badge-assets';

type CompactSize = 'default' | 'small';

type Props = {
  icons: DisplayIcon[];
  compact?: boolean;
  compactSize?: CompactSize;
  // compact 模式下最多展示几个徽章，其余折叠成 "+N"。默认 3；空间紧张的卡片
  // （如广场帖头部，要给用户名/圈子标签让位）可传更小值。非 compact 不受影响。
  maxVisible?: number;
  // compact 下超出 maxVisible 时是否显示 "+N" 折叠计数。默认 true；广场帖头部
  // 传 false —— 超出不折叠，只固定展示前 maxVisible 枚（配合上游按优先级排序）。
  showOverflowCount?: boolean;
};

type BadgeProps = {
  icon: DisplayIcon;
  compact?: boolean;
  compactSize?: CompactSize;
  dense?: boolean;
  // 显式像素尺寸（如徽章详情大图）。给定时按该尺寸原生渲染，不走 compact/default 档，
  // 也不靠 transform 放大 —— 避免把小尺寸位图上采样糊掉。
  size?: number;
};

const CIRCLE_BADGE_LABEL = '圈子徽章';

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  smallCompactRow: {
    gap: 4,
  },
  item: {
    alignItems: 'center',
    gap: 6,
  },
  denseItem: {
    gap: 2,
  },
  // 圈子徽章 = 一张圆形裁切的图(同圈子详情页),不加底盘和描边。直径和同档系统徽章的
  // 可见画面一样大(外壳 52 / 38 / 30 里的 40 / 34 / 28),在外壳里居中。
  circle: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badgeFrame: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactBadgeFrame: {
    width: 38,
    height: 38,
  },
  smallCompactBadgeFrame: {
    width: 30,
    height: 30,
  },
  compactCircle: {
    width: 34,
    height: 34,
  },
  smallCompactCircle: {
    width: 28,
    height: 28,
  },
  systemBadgeShell: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactSystemBadgeShell: {
    width: 38,
    height: 38,
  },
  smallCompactSystemBadgeShell: {
    width: 30,
    height: 30,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  systemBadgeImage: {
    width: '100%',
    height: '100%',
  },
  label: {
    maxWidth: 62,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0,
    textAlign: 'center',
  },
  compactCount: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  smallCompactCount: {
    width: 26,
    height: 26,
  },
});

// 导出给其它 icon 渲染点复用（如 friend-card-bubble）：裸 as-cast 只挡得住
// null/undefined，挡不住「存在但不合法」的 glyph 名——那会渲染成空白。
export function resolveFallbackIcon(
  name: string | null | undefined,
  fallback: keyof typeof Ionicons.glyphMap = 'sparkles-outline',
) {
  if (name && name in Ionicons.glyphMap) {
    return name as keyof typeof Ionicons.glyphMap;
  }
  return fallback;
}

function isRenderableIcon(
  icon: Partial<DisplayIcon> | null | undefined,
): icon is DisplayIcon {
  if (!icon || typeof icon !== 'object') {
    return false;
  }

  const hasValidType = icon.type === 'SYSTEM' || icon.type === 'CIRCLE';
  const hasIdentity =
    typeof icon.id === 'string' ||
    typeof icon.systemKey === 'string' ||
    typeof icon.circleId === 'string' ||
    typeof icon.title === 'string';

  return hasValidType && hasIdentity;
}

function buildIconKey(icon: Partial<DisplayIcon>, index: number) {
  return [
    icon.type ?? 'UNKNOWN',
    icon.systemVariant ??
      icon.systemKey ??
      icon.circleId ??
      icon.id ??
      icon.title ??
      'icon',
    index,
  ].join('-');
}

function dedupeIcons(icons: DisplayIcon[]): DisplayIcon[] {
  const seen = new Set<string>();

  return icons.filter((icon) => {
    const identity = [
      icon.type,
      icon.systemVariant ??
        icon.systemKey ??
        icon.circleId ??
        icon.id ??
        icon.title,
    ].join(':');
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function getVipLevel(icon: DisplayIcon) {
  return icon.title.match(/\d+/)?.[0] ?? null;
}

function formatIconLabel(icon: DisplayIcon) {
  if (icon.systemKey === 'VIP') {
    const level = getVipLevel(icon);
    return level ? `VIP${level}` : icon.title || 'VIP';
  }

  if (icon.systemKey === 'NEW_USER') {
    return icon.title || 'New Joiner';
  }

  if (icon.systemKey === 'TOP_COLLABORATOR') {
    return icon.title || 'Top Collaborator';
  }

  if (icon.systemKey === 'VERIFIED_PROFILE') {
    return icon.title || 'Verified';
  }

  if (icon.systemKey === 'CIRCLE_BUILDER') {
    return icon.title || 'Builder';
  }

  return icon.title;
}

// 徽章外壳尺寸：非 compact 用基础尺寸(在样式里)，compact 分 default/small 两档，
// 且 system-badge 与普通 circle 各一套。查表取代深层嵌套三元。
function resolveShellSizeStyle(
  compact: boolean,
  isSmallCompact: boolean,
  hasSystemAsset: boolean,
) {
  if (!compact) return null;
  if (hasSystemAsset) {
    return isSmallCompact
      ? s.smallCompactSystemBadgeShell
      : s.compactSystemBadgeShell;
  }
  return isSmallCompact ? s.smallCompactBadgeFrame : s.compactBadgeFrame;
}

function resolveCircleSizeStyle(compact: boolean, isSmallCompact: boolean) {
  if (!compact) return null;
  return isSmallCompact ? s.smallCompactCircle : s.compactCircle;
}

export function UserIconBadge({
  icon,
  compact = false,
  compactSize = 'default',
  dense = false,
  size,
}: BadgeProps) {
  const { colors } = useTheme();
  const systemBadgeAsset =
    icon.type === 'SYSTEM' ? getSystemBadgeAsset(icon) : null;
  // 本地系统徽章在 OTA/旧原生包或 Web 静态资源路径失效时，expo-image 会保留
  // 52px 的占位盒但不绘制任何像素。记录单个徽章的加载失败，让下面的通用
  // 圆形/矢量 fallback 接管，避免资料页出现“只有标题、图标全空”的死状态。
  const [failedSystemBadge, setFailedSystemBadge] = useState<{ identity: string | null; asset: unknown } | null>(null);
  const [failedCircleIdentity, setFailedCircleIdentity] = useState<string | null>(null);
  const systemBadgeIdentity =
    icon.type === 'SYSTEM'
      ? `${icon.id}:${icon.systemKey ?? ''}:${icon.systemVariant ?? ''}`
      : null;
  const circleImageIdentity =
    icon.imageUrl
      ? `${icon.type}:${icon.id}:${icon.circleId ?? ''}:${icon.imageUrl}`
      : null;
  const circleImageUri = icon.imageUrl ?? undefined;
  const currentSystemBadge = useRef({ identity: systemBadgeIdentity, asset: systemBadgeAsset });
  const currentCircleIdentity = useRef(circleImageIdentity);
  currentSystemBadge.current = { identity: systemBadgeIdentity, asset: systemBadgeAsset };
  currentCircleIdentity.current = circleImageIdentity;
  const hasSystemBadgeImage = Boolean(systemBadgeAsset) &&
    !(failedSystemBadge?.identity === systemBadgeIdentity && failedSystemBadge?.asset === systemBadgeAsset);
  const hasCircleImage = Boolean(circleImageUri) && failedCircleIdentity !== circleImageIdentity;
  // 徽章下面不再画名字(新手/会员/圈子徽章),名字只留给读屏。
  const label =
    icon.type === 'SYSTEM' ? formatIconLabel(icon) : CIRCLE_BADGE_LABEL;
  const isSmallCompact = compact && compactSize === 'small';
  // 显式 size（详情大图）优先：按该尺寸原生定尺寸、不做 transform 放大 —— 小图上采样才是糊的根因。
  // 四态尺寸（default / compact / smallCompact × system-badge / circle）用查表替代
  // 深层嵌套三元，可读且易扩展。显式 size 分支直接用 size（此处已收窄为 number）。
  const shellSizeStyle =
    size !== undefined
      ? { width: size, height: size }
      : resolveShellSizeStyle(
          compact,
          isSmallCompact,
          Boolean(systemBadgeAsset),
        );
  const circleSizeStyle =
    size !== undefined
      ? {
          width: Math.round((size * 40) / 52),
          height: Math.round((size * 40) / 52),
        }
      : resolveCircleSizeStyle(compact, isSmallCompact);
  // 系统徽章外壳边长(素材 contain 进这个方框,画布长边 = 外壳边长)。
  const shellSize = size ?? (compact ? (isSmallCompact ? 30 : 38) : 52);
  // 系统徽章的可见画面要和同档圆形圈子徽章一样大、圆心对齐:
  // 圈子徽章直径 / 外壳 = 40/52(默认与显式 size)、34/38(compact)、28/30(compact small)。
  const circleToShellRatio = size !== undefined || !compact
    ? 40 / 52
    : isSmallCompact
      ? 28 / 30
      : 34 / 38;
  const art = icon.type === 'SYSTEM' ? getSystemBadgeArtBox(icon) : null;
  // 保留三位小数:比例刚好相等时不挂多余的 transform。
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const systemBadgeScale = art ? round(circleToShellRatio / art.visibleRatio) : 1;
  // 画面中心偏离素材中心多少,放大后就偏多少像素;反向挪回外壳中心。平移写在缩放前面,
  // 数值就是屏幕上的实际像素(写在后面会被缩放再放大一次)。
  const systemBadgeTranslateX = art ? round(-art.offsetX * shellSize * systemBadgeScale) : 0;
  const systemBadgeTranslateY = art ? round(-art.offsetY * shellSize * systemBadgeScale) : 0;
  const systemBadgeTransform = [
    ...(systemBadgeTranslateX !== 0 ? [{ translateX: systemBadgeTranslateX }] : []),
    ...(systemBadgeTranslateY !== 0 ? [{ translateY: systemBadgeTranslateY }] : []),
    ...(systemBadgeScale !== 1 ? [{ scale: systemBadgeScale }] : []),
  ];

  return (
    <View
      style={[s.item, dense ? s.denseItem : null]}
      accessible
      accessibilityLabel={label}
    >
      <View
        style={[
          hasSystemBadgeImage ? s.systemBadgeShell : s.badgeFrame,
          shellSizeStyle,
        ]}
      >
        {hasSystemBadgeImage ? (
          <Image
            source={systemBadgeAsset}
            style={[
              s.systemBadgeImage,
              systemBadgeTransform.length > 0
                ? { transform: systemBadgeTransform }
                : null,
            ]}
            contentFit="contain"
            onError={() => {
              if (currentSystemBadge.current.identity === systemBadgeIdentity && currentSystemBadge.current.asset === systemBadgeAsset)
                setFailedSystemBadge({ identity: systemBadgeIdentity, asset: systemBadgeAsset });
            }}
          />
        ) : (
          <View
            style={[
              s.circle,
              circleSizeStyle,
              // 没图时才垫底色,有图就是图本身。不能用 white:暗色主题的 textSecondary 也是纯白,兜底图标会被吞掉。
              hasCircleImage ? null : { backgroundColor: colors.surfaceMuted },
            ]}
          >
            {hasCircleImage ? (
              <Image
                source={{ uri: circleImageUri }}
                recyclingKey={circleImageUri}
                style={s.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
                onError={() => {
                  if (currentCircleIdentity.current === circleImageIdentity) setFailedCircleIdentity(circleImageIdentity);
                }}
              />
            ) : (
              <Ionicons
                name={resolveFallbackIcon(icon.fallbackIconName)}
                size={
                  size !== undefined
                    ? Math.round((size * 14) / 52)
                    : compact
                      ? isSmallCompact
                        ? 10
                        : 12
                      : 14
                }
                color={colors.textSecondary}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function UserIconRowComponent({
  icons,
  compact = false,
  compactSize = 'default',
  maxVisible = 3,
  showOverflowCount = true,
}: Props) {
  const { colors } = useTheme();
  const safeIcons = dedupeIcons(icons.filter((icon) => isRenderableIcon(icon)));
  const compactLimit = Math.max(1, maxVisible);
  const visibleIcons = compact ? safeIcons.slice(0, compactLimit) : safeIcons;
  const hiddenCount =
    compact && showOverflowCount
      ? Math.max(0, safeIcons.length - visibleIcons.length)
      : 0;
  const isSmallCompact = compact && compactSize === 'small';

  if (safeIcons.length === 0) {
    return null;
  }

  return (
    <View style={[s.row, isSmallCompact ? s.smallCompactRow : null]}>
      {visibleIcons.map((icon, index) => (
        <UserIconBadge
          key={buildIconKey(icon, index)}
          icon={icon}
          compact={compact}
          compactSize={compactSize}
        />
      ))}
      {hiddenCount > 0 ? (
        <View
          style={[
            s.compactCount,
            isSmallCompact ? s.smallCompactCount : null,
            {
              backgroundColor: colors.surface,
              borderColor: colors.surfaceBorder,
            },
          ]}
        >
          <Text
            style={[s.label, { color: colors.textSecondary }]}
          >{`+${hiddenCount}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

export const UserIconRow = memo(UserIconRowComponent);
