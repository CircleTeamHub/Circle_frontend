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
};

type BadgeProps = {
  icon: DisplayIcon;
  compact?: boolean;
  compactSize?: CompactSize;
  dense?: boolean;
  tone?: 'default' | 'member';
};

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
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactCircle: {
    width: 34,
    height: 34,
  },
  smallCompactCircle: {
    width: 26,
    height: 26,
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
  return isSmallCompact ? s.smallCompactCircle : s.compactCircle;
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
  const label = icon.type === 'SYSTEM' ? formatIconLabel(icon) : icon.circleName ?? icon.title;
  const labelColor = tone === 'member' ? colors.white : colors.text;
  const isSmallCompact = compact && compactSize === 'small';
  // 四态尺寸（default / compact / smallCompact × system-badge / circle）用查表替代
  // 深层嵌套三元，可读且易扩展。
  const shellSizeStyle = resolveShellSizeStyle(compact, isSmallCompact, Boolean(systemBadgeAsset));

  return (
    <View style={[s.item, dense ? s.denseItem : null]}>
      <View
        style={[
          systemBadgeAsset ? s.systemBadgeShell : s.circle,
          shellSizeStyle,
          systemBadgeAsset
            ? null
            : { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
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
          <View style={s.imageWrap}>
            {icon.imageUrl ? (
              <Image source={{ uri: icon.imageUrl }} style={s.image} contentFit="cover" />
            ) : (
              <Ionicons
                name={resolveFallbackIcon(icon.fallbackIconName)}
                size={compact ? (isSmallCompact ? 10 : 12) : 14}
                color={colors.textSecondary}
              />
            )}
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
}: Props) {
  const { colors } = useTheme();
  const safeIcons = icons.filter((icon) => isRenderableIcon(icon));
  const visibleIcons = compact ? safeIcons.slice(0, 3) : safeIcons;
  const hiddenCount = compact ? Math.max(0, safeIcons.length - visibleIcons.length) : 0;
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
