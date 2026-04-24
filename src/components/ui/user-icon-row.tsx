import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { DisplayIcon } from '@/types';
import { SystemIconArt } from '@/components/ui/system-icon-art';

type Props = {
  icons: DisplayIcon[];
  compact?: boolean;
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
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  label: {
    ...Typography.tiny,
    fontWeight: '700',
  },
  compactCount: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
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

function UserIconRowComponent({ icons, compact = false }: Props) {
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
        <View key={buildIconKey(icon, index)} style={s.item}>
          <View
            style={[
              s.circle,
              {
                backgroundColor: colors.memberTagBgLight,
                borderWidth: 1,
                borderColor: colors.surfaceBorder,
              },
            ]}
          >
            {icon.type === 'SYSTEM' && icon.systemKey === 'VIP' ? (
              <SystemIconArt systemKey="VIP" size={44} />
            ) : icon.type === 'SYSTEM' && icon.systemKey === 'NEW_USER' ? (
              <SystemIconArt systemKey="NEW_USER" size={44} />
            ) : icon.imageUrl ? (
              <Image source={{ uri: icon.imageUrl }} style={s.image} contentFit="cover" />
            ) : (
              <Ionicons
                name={resolveFallbackIcon(icon.fallbackIconName)}
                size={20}
                color={colors.memberCardText}
              />
            )}
          </View>
          {!compact ? (
            <Text style={[s.label, { color: colors.memberCardText }]} numberOfLines={1}>
              {icon.title}
            </Text>
          ) : null}
        </View>
      ))}
      {hiddenCount > 0 ? (
        <View
          style={[
            s.compactCount,
            {
              backgroundColor: colors.surface,
              borderWidth: 1,
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
