import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';

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
  innerRing: {
    position: 'absolute',
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
    borderRadius: Radius.full,
    borderWidth: 1,
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
  systemPrefix: {
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  systemMain: {
    fontSize: 15,
    lineHeight: 17,
    fontWeight: '900',
    letterSpacing: 0,
  },
  compactSystemMain: {
    fontSize: 13,
    lineHeight: 15,
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
    return icon.title || '新用户';
  }

  return icon.title;
}

export function UserIconBadge({ icon, compact = false, tone = 'default' }: BadgeProps) {
  const { colors } = useTheme();
  const isVip = icon.type === 'SYSTEM' && icon.systemKey === 'VIP';
  const isNewUser = icon.type === 'SYSTEM' && icon.systemKey === 'NEW_USER';
  const label = icon.type === 'SYSTEM' ? formatIconLabel(icon) : icon.circleName ?? icon.title;
  const level = getVipLevel(icon);
  const circleStyle = isVip
    ? {
        backgroundColor: colors.memberTagBg,
        borderColor: colors.vipBadgeBorder,
      }
    : isNewUser
      ? {
          backgroundColor: colors.newUserBadgeBg,
          borderColor: colors.newUserBadgeBorder,
        }
      : {
          backgroundColor: colors.surface,
          borderColor: colors.surfaceBorder,
        };
  const accentColor = isVip
    ? colors.vipBadgeAccent
    : isNewUser
      ? colors.newUserBadgeAccent
      : colors.textSecondary;
  // member tone 仅用于个人页紫色渐变会员卡，标签用白色保证对比度
  const labelColor = tone === 'member' ? colors.white : colors.text;

  return (
    <View style={s.item}>
      <View style={[s.circle, compact ? s.compactCircle : null, circleStyle]}>
        {isVip ? (
          <>
            <View style={[s.innerRing, { borderColor: colors.vipBadgeRing }]} />
            <Text style={[s.systemPrefix, { color: accentColor }]}>VIP</Text>
            <Text
              style={[
                s.systemMain,
                compact ? s.compactSystemMain : null,
                { color: accentColor },
              ]}
            >
              {level ?? ''}
            </Text>
          </>
        ) : isNewUser ? (
          <>
            <View style={[s.innerRing, { borderColor: colors.newUserBadgeRing }]} />
            <Text
              style={[
                s.systemMain,
                compact ? s.compactSystemMain : null,
                { color: accentColor },
              ]}
            >
              新
            </Text>
          </>
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
