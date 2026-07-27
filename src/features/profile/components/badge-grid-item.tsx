import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserIconBadge } from '@/components/ui/user-icon-row';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { BadgeView } from '@/features/profile/badge-catalog';

interface BadgeGridItemProps {
  badge: BadgeView;
  /** 该徽章当前是否在资料展示位（仅已拥有可能为 true）。 */
  selected: boolean;
  /** 「展示中」标签文案。 */
  displayingLabel: string;
  onPress: (badge: BadgeView) => void;
}

const s = StyleSheet.create({
  chip: {
    width: 100,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    gap: 4,
  },
  badgeWrap: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: {
    opacity: 0.38,
  },
  lockPin: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...Typography.small,
    fontWeight: '700',
    textAlign: 'center',
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  tagText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  tagSpacer: {
    height: 17,
  },
});

function BadgeGridItemComponent({
  badge,
  selected,
  displayingLabel,
  onPress,
}: BadgeGridItemProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        s.chip,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? colors.primary : colors.surfaceBorder,
        },
      ]}
      onPress={() => onPress(badge)}
    >
      <View style={s.badgeWrap}>
        <View style={badge.owned ? null : s.locked}>
          <UserIconBadge icon={badge.previewIcon} compact />
        </View>
        {badge.owned ? null : (
          <View
            style={[
              s.lockPin,
              {
                backgroundColor: colors.surface,
                borderColor: colors.surfaceBorder,
              },
            ]}
          >
            <Ionicons name="lock-closed" size={11} color={colors.textSecondary} />
          </View>
        )}
      </View>
      <Text
        style={[s.title, { color: badge.owned ? colors.text : colors.textSecondary }]}
        numberOfLines={1}
      >
        {badge.title}
      </Text>
      {selected ? (
        <View style={[s.tag, { backgroundColor: colors.primary }]}>
          <Text style={[s.tagText, { color: colors.white }]} numberOfLines={1}>
            {displayingLabel}
          </Text>
        </View>
      ) : (
        <View style={s.tagSpacer} />
      )}
    </Pressable>
  );
}

export const BadgeGridItem = memo(BadgeGridItemComponent);
