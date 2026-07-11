import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';
import { getSystemBadgeAsset, getSystemBadgeVisualScale } from './user-badge-assets';

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
    width: 40,
    height: 40,
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
    width: 46,
    height: 46,
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

function resolveFallbackIcon(name: string | null | undefined) {
  if (name && name in Ionicons.glyphMap) {
    return name as keyof typeof Ionicons.glyphMap;
  }
  return 'sparkles-outline';
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
}: BadgeProps) {
  const { colors } = useTheme();
  const systemBadgeAsset = icon.type === 'SYSTEM' ? getSystemBadgeAsset(icon) : null;
  const systemBadgeScale = icon.type === 'SYSTEM' ? getSystemBadgeVisualScale(icon) : 1;
  const label = icon.type === 'SYSTEM' ? formatIconLabel(icon) : CIRCLE_BADGE_LABEL;
  const labelColor = tone === 'member' ? colors.white : colors.text;
  const isSmallCompact = compact && compactSize === 'small';
  // 四态尺寸（default / compact / smallCompact × system-badge / circle）用查表替代
  // 深层嵌套三元，可读且易扩展。
  const shellSizeStyle = resolveShellSizeStyle(compact, isSmallCompact, Boolean(systemBadgeAsset));
  const circleSizeStyle = resolveCircleSizeStyle(compact, isSmallCompact);
  const circleOrnamentSizeStyle = resolveCircleOrnamentSizeStyle(compact, isSmallCompact);

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
              systemBadgeScale !== 1 ? { transform: [{ scale: systemBadgeScale }] } : null,
            ]}
            contentFit="contain"
          />
        ) : (
          <View style={[s.circleSlot, !compact ? s.circleSlotRaised : null]}>
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
                  { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
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
                      size={compact ? (isSmallCompact ? 10 : 12) : 14}
                      color={colors.textSecondary}
                    />
                  )}
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
      {!compact ? (
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
  const safeIcons = icons.filter((icon) => isRenderableIcon(icon));
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
