import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';
import {
  getSystemBadgeAsset,
  getSystemBadgeVisualScale,
  getSystemBadgeVisualTranslateY,
} from './user-badge-assets';

type CompactSize = 'default' | 'small';

type Props = {
  icons: DisplayIcon[];
  compact?: boolean;
  compactSize?: CompactSize;
  tone?: 'default' | 'member';
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
  tone?: 'default' | 'member';
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
  circle: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    borderWidth: 1,
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
  circleSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSlotRaised: {
    transform: [{ translateY: -4 }],
  },
  circleOrnament: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  compactCircleOrnament: {
    width: 34,
    height: 34,
  },
  smallCompactCircleOrnament: {
    width: 28,
    height: 28,
  },
  compactCircle: {
    width: 30,
    height: 30,
  },
  smallCompactCircle: {
    width: 24,
    height: 24,
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
  imageWrap: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
  denseLabel: {
    marginTop: -6,
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
    icon.systemVariant ?? icon.systemKey ?? icon.circleId ?? icon.id ?? icon.title ?? 'icon',
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
    return isSmallCompact ? s.smallCompactSystemBadgeShell : s.compactSystemBadgeShell;
  }
  return isSmallCompact ? s.smallCompactBadgeFrame : s.compactBadgeFrame;
}

function resolveCircleSizeStyle(
  compact: boolean,
  isSmallCompact: boolean,
) {
  if (!compact) return null;
  return isSmallCompact ? s.smallCompactCircle : s.compactCircle;
}

function resolveCircleOrnamentSizeStyle(
  compact: boolean,
  isSmallCompact: boolean,
) {
  if (!compact) return null;
  return isSmallCompact ? s.smallCompactCircleOrnament : s.compactCircleOrnament;
}

export function UserIconBadge({
  icon,
  compact = false,
  compactSize = 'default',
  dense = false,
  tone = 'default',
  size,
}: BadgeProps) {
  const { colors } = useTheme();
  const systemBadgeAsset = icon.type === 'SYSTEM' ? getSystemBadgeAsset(icon) : null;
  const systemBadgeScale = icon.type === 'SYSTEM' ? getSystemBadgeVisualScale(icon) : 1;
  const systemBadgeTranslateY = icon.type === 'SYSTEM' ? getSystemBadgeVisualTranslateY(icon) : 0;
  const label = icon.type === 'SYSTEM' ? formatIconLabel(icon) : CIRCLE_BADGE_LABEL;
  const labelColor = tone === 'member' ? colors.white : colors.text;
  const isSmallCompact = compact && compactSize === 'small';
  // 显式 size（详情大图）优先：按该尺寸原生定尺寸、不做 transform 放大 —— 小图上采样才是糊的根因。
  const hasExplicitSize = size !== undefined;
  const showLabel = !compact && !hasExplicitSize;
  // 四态尺寸（default / compact / smallCompact × system-badge / circle）用查表替代
  // 深层嵌套三元，可读且易扩展。显式 size 分支直接用 size（此处已收窄为 number）。
  const shellSizeStyle =
    size !== undefined
      ? { width: size, height: size }
      : resolveShellSizeStyle(compact, isSmallCompact, Boolean(systemBadgeAsset));
  const circleSizeStyle =
    size !== undefined
      ? { width: Math.round((size * 34) / 52), height: Math.round((size * 34) / 52) }
      : resolveCircleSizeStyle(compact, isSmallCompact);
  const circleOrnamentSizeStyle =
    size !== undefined
      ? { width: Math.round((size * 40) / 52), height: Math.round((size * 40) / 52) }
      : resolveCircleOrnamentSizeStyle(compact, isSmallCompact);
  const transformSizeRatio =
    size !== undefined
      ? size / 52
      : compact
        ? isSmallCompact
          ? 30 / 52
          : 38 / 52
        : 1;
  const systemBadgeTransform = [
    ...(systemBadgeScale !== 1 ? [{ scale: systemBadgeScale }] : []),
    ...(systemBadgeTranslateY !== 0
      ? [{ translateY: systemBadgeTranslateY * transformSizeRatio }]
      : []),
  ];

  return (
    <View style={[s.item, dense ? s.denseItem : null]}>
      <View
        style={[
          systemBadgeAsset ? s.systemBadgeShell : s.badgeFrame,
          shellSizeStyle,
        ]}
      >
        {systemBadgeAsset ? (
          <Image
            source={systemBadgeAsset}
            style={[
              s.systemBadgeImage,
              systemBadgeTransform.length > 0 ? { transform: systemBadgeTransform } : null,
            ]}
            contentFit="contain"
          />
        ) : (
          <View style={[s.circleSlot, !compact && !hasExplicitSize ? s.circleSlotRaised : null]}>
            <View
              style={[
                s.circleOrnament,
                circleOrnamentSizeStyle,
                { backgroundColor: colors.white, borderColor: colors.surfaceBorder },
              ]}
            >
              <View
                style={[
                  s.circle,
                  circleSizeStyle,
                  // 徽章内盘固定浅底：深色模式下 surface 是深色，会把圈子图标（多为深色线稿/
                  // 透明底）吞成黑块。用 white 保持奖章质感，两种模式都有对比。
                  { backgroundColor: colors.white, borderColor: colors.surfaceBorder },
                ]}
              >
                <View style={s.imageWrap}>
                  {icon.imageUrl ? (
                    <Image
                      source={{ uri: icon.imageUrl }}
                      recyclingKey={icon.imageUrl}
                      style={s.image}
                      contentFit="cover"
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
              </View>
            </View>
          </View>
        )}
      </View>
      {showLabel ? (
        <Text
          style={[s.label, dense ? s.denseLabel : null, { color: labelColor }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

function UserIconRowComponent({
  icons,
  compact = false,
  compactSize = 'default',
  tone = 'default',
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
          tone={tone}
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
          <Text style={[s.label, { color: colors.textSecondary }]}>{`+${hiddenCount}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

export const UserIconRow = memo(UserIconRowComponent);
