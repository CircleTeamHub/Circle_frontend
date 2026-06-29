import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';
import { getSystemBadgeAsset } from './user-badge-assets';

type Props = {
  icons: DisplayIcon[];
  compact?: boolean;
  tone?: 'default' | 'member';
};

type BadgeProps = {
  icon: DisplayIcon;
  compact?: boolean;
  tone?: 'default' | 'member';
};

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  item: {
    alignItems: 'center',
    gap: 6,
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
  compactCount: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
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
    icon.systemKey ?? icon.circleId ?? icon.id ?? icon.title ?? 'icon',
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

  return icon.title;
}

export function UserIconBadge({ icon, compact = false, tone = 'default' }: BadgeProps) {
  const { colors } = useTheme();
  const systemBadgeAsset = icon.type === 'SYSTEM' ? getSystemBadgeAsset(icon) : null;
  const label = icon.type === 'SYSTEM' ? formatIconLabel(icon) : icon.circleName ?? icon.title;
  const labelColor = tone === 'member' ? colors.white : colors.text;

  return (
    <View style={s.item}>
      <View
        style={[
          systemBadgeAsset ? s.systemBadgeShell : s.circle,
          compact ? (systemBadgeAsset ? s.compactSystemBadgeShell : s.compactCircle) : null,
          systemBadgeAsset
            ? null
            : { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
        ]}
      >
        {systemBadgeAsset ? (
          <Image source={systemBadgeAsset} style={s.systemBadgeImage} contentFit="contain" />
        ) : (
          <View style={s.imageWrap}>
            {icon.imageUrl ? (
              <Image source={{ uri: icon.imageUrl }} style={s.image} contentFit="cover" />
            ) : (
              <Ionicons
                name={resolveFallbackIcon(icon.fallbackIconName)}
                size={compact ? 12 : 14}
                color={colors.textSecondary}
              />
            )}
          </View>
        )}
      </View>
      {!compact ? (
        <Text style={[s.label, { color: labelColor }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

function UserIconRowComponent({ icons, compact = false, tone = 'default' }: Props) {
  const { colors } = useTheme();
  const safeIcons = icons.filter((icon) => isRenderableIcon(icon));
  const visibleIcons = compact ? safeIcons.slice(0, 3) : safeIcons;
  const hiddenCount = compact ? Math.max(0, safeIcons.length - visibleIcons.length) : 0;

  if (safeIcons.length === 0) {
    return null;
  }

  return (
    <View style={s.row}>
      {visibleIcons.map((icon, index) => (
        <UserIconBadge
          key={buildIconKey(icon, index)}
          icon={icon}
          compact={compact}
          tone={tone}
        />
      ))}
      {hiddenCount > 0 ? (
        <View
          style={[
            s.compactCount,
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
