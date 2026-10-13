import { Ionicons } from '@expo/vector-icons';
import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Radius, Spacing, Typography, useTheme } from '@/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface HeaderAction {
  key: 'recycleBin' | 'unlisted' | 'drafts';
  icon: IoniconName;
  label: string;
  onPress: () => void;
}

interface NotesHeaderActionsProps {
  /** 窄屏（手机）用独立的圆角小方块，宽屏沿用横排胶囊。 */
  compact: boolean;
  onOpenRecycleBin: () => void;
  onOpenUnlisted: () => void;
  onOpenDrafts: () => void;
}

/**
 * 我的笔记页右上角的三个入口（回收站 / 已下架 / 草稿箱）。
 *
 * 手机上三个「图标+文字」横排放不下（英文标签更长），改成三个独立的圆角小方块：
 * 图标在上、文字在下。只给图标会看不出用途，每个入口都必须带文字。
 */
export const NotesHeaderActions: React.FC<NotesHeaderActionsProps> = memo(
  function NotesHeaderActions({ compact, onOpenRecycleBin, onOpenUnlisted, onOpenDrafts }) {
    const { colors } = useTheme();
    const { t } = useTranslation();

    const actions = useMemo<HeaderAction[]>(
      () => [
        {
          key: 'recycleBin',
          icon: 'trash-outline',
          label: t('notes.recycleBin', { defaultValue: '回收站' }),
          onPress: onOpenRecycleBin,
        },
        {
          key: 'unlisted',
          icon: 'archive-outline',
          label: t('notes.unlisted', { defaultValue: '已下架' }),
          onPress: onOpenUnlisted,
        },
        {
          key: 'drafts',
          icon: 'document-text-outline',
          label: t('notes.drafts.title', { defaultValue: '草稿箱' }),
          onPress: onOpenDrafts,
        },
      ],
      [t, onOpenRecycleBin, onOpenUnlisted, onOpenDrafts],
    );

    const d = useMemo(
      () => ({
        surface: { backgroundColor: colors.surface },
        label: { color: colors.text },
      }),
      [colors],
    );

    if (!compact) {
      return (
        <View style={s.pillRow}>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={[s.pill, d.surface]}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Ionicons name={action.icon} size={15} color={colors.textSecondary} />
              <Text style={[s.pillLabel, d.label]} numberOfLines={1}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      );
    }

    return (
      <View style={s.tileRow}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            style={({ pressed }) => [s.tile, d.surface, pressed && s.tilePressed]}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <Ionicons name={action.icon} size={18} color={colors.text} />
            <Text style={[s.tileLabel, d.label]} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  },
);

const s = StyleSheet.create({
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  pillLabel: { ...Typography.small, fontWeight: '500' },
  tileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  tile: {
    minWidth: 52,
    minHeight: 48,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tilePressed: { opacity: 0.5 },
  tileLabel: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
});
