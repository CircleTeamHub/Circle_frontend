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
              <Text
                style={[s.pillLabel, d.label]}
                numberOfLines={1}
                maxFontSizeMultiplier={HEADER_LABEL_MAX_FONT_SCALE}
              >
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
            <Text
              style={[s.tileLabel, d.label]}
              numberOfLines={1}
              maxFontSizeMultiplier={HEADER_LABEL_MAX_FONT_SCALE}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  },
);

/**
 * 页头只有一行：返回键 + 三个入口。系统大字号下标签继续放大会把入口挤出屏幕，
 * 这里把标签放大上限定在 1.3 倍（无障碍朗读仍读完整标签），超出的宽度靠
 * 方块收缩 + 单行省略消化。
 */
const HEADER_LABEL_MAX_FONT_SCALE = 1.3;

const s = StyleSheet.create({
  pillRow: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  pillLabel: { flexShrink: 1, ...Typography.small, fontWeight: '500' },
  tileRow: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  // 可以收缩（窄屏 + 大字号时三块平分剩余宽度），但不小于 44 的点击区域。
  tile: {
    flexShrink: 1,
    minWidth: 44,
    maxWidth: 88,
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tilePressed: { opacity: 0.5 },
  tileLabel: { maxWidth: '100%', fontSize: 11, lineHeight: 14, fontWeight: '500' },
});
