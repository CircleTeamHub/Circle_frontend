import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { ChatTargetAvatar } from './ChatTargetAvatar';
import type { ChatTarget } from './types';

const AVATAR_SIZE = 56;

interface RecentForwardStripProps {
  targets: ChatTarget[];
  selectedKeys: ReadonlySet<string>;
  onPress: (target: ChatTarget) => void;
  onRemove: (target: ChatTarget) => void;
  onClear: () => void;
}

const s = StyleSheet.create({
  wrap: { paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.body, fontWeight: '700' },
  clear: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full },
  clearText: { ...Typography.small },
  row: { paddingHorizontal: Spacing.md, gap: Spacing.md },
  item: { width: AVATAR_SIZE, alignItems: 'center', gap: Spacing.xs },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedMark: { position: 'absolute', bottom: -4, right: -4 },
  label: { ...Typography.tinyRegular, width: AVATAR_SIZE + Spacing.sm, textAlign: 'center' },
});

/** 选择页顶部的「最近转发」:横排头像,点头像直接选,右上角 × 从记录里删掉。 */
export function RecentForwardStrip({
  targets,
  selectedKeys,
  onPress,
  onRemove,
  onClear,
}: RecentForwardStripProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (targets.length === 0) return null;
  return (
    <View style={[s.wrap, { backgroundColor: colors.surface }]}>
      <View style={s.header}>
        <Text style={[s.title, { color: colors.text }]}>
          {t('chat.targetPicker.recentForwards', { defaultValue: '最近转发' })}
        </Text>
        <Pressable
          style={[s.clear, { backgroundColor: colors.inputBg }]}
          onPress={onClear}
          accessibilityRole="button"
        >
          <Text style={[s.clearText, { color: colors.textSecondary }]}>
            {t('chat.targetPicker.clearRecent', { defaultValue: '清空' })}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {targets.map((target) => (
          <Pressable
            key={target.key}
            style={s.item}
            onPress={() => onPress(target)}
            accessibilityRole="button"
            accessibilityLabel={target.name}
            accessibilityState={{ selected: selectedKeys.has(target.key) }}
          >
            <View>
              <ChatTargetAvatar target={target} size={AVATAR_SIZE} />
              <Pressable
                style={[s.remove, { backgroundColor: colors.error }]}
                onPress={() => onRemove(target)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t('chat.targetPicker.removeRecent', {
                  name: target.name,
                  defaultValue: '从最近转发移除 {{name}}',
                })}
              >
                <Ionicons name="close" size={12} color={colors.white} />
              </Pressable>
              {selectedKeys.has(target.key) ? (
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.primary}
                  style={s.selectedMark}
                />
              ) : null}
            </View>
            <Text style={[s.label, { color: colors.textSecondary }]} numberOfLines={1}>
              {target.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
