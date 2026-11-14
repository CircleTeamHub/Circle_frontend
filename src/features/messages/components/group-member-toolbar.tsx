import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { ConversationMemberFilter } from '@/features/messages/utils/conversation-member-filter';

interface GroupMemberToolbarProps {
  selectedCount: number;
  query: string;
  onChangeQuery: (query: string) => void;
  filter: ConversationMemberFilter;
  onChangeFilter: (filter: ConversationMemberFilter) => void;
  resultCount: number;
  allResultsSelected: boolean;
  onToggleResults: () => void;
  disabled: boolean;
}

const FILTERS: { id: ConversationMemberFilter; key: string; fallback: string }[] = [
  { id: 'all', key: 'messages.groups.filterAll', fallback: '全部' },
  { id: 'group', key: 'messages.groups.groupChat', fallback: '群聊' },
  { id: 'private', key: 'messages.groups.directChat', fallback: '私聊' },
  { id: 'selected', key: 'messages.groups.filterSelected', fallback: '已选' },
];

const s = StyleSheet.create({
  root: { gap: Spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.caption, fontWeight: '600' },
  count: { ...Typography.small, fontVariant: ['tabular-nums'] },
  searchBox: {
    height: 40,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  searchInput: { flex: 1, height: '100%', paddingVertical: 0, ...Typography.bodyRegular },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    height: 32,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  chipText: { ...Typography.caption },
  bulkRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bulkText: { ...Typography.caption, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});

export const GroupMemberToolbar = memo(function GroupMemberToolbar({
  selectedCount,
  query,
  onChangeQuery,
  filter,
  onChangeFilter,
  resultCount,
  allResultsSelected,
  onToggleResults,
  disabled,
}: GroupMemberToolbarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      secondary: { color: colors.textSecondary },
      field: { borderColor: colors.surfaceBorder, backgroundColor: colors.surface },
      input: { color: colors.text },
      chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
      chipTextActive: { color: colors.white },
      link: { color: colors.primary },
    }),
    [colors],
  );
  const bulkDisabled = disabled || resultCount === 0;

  return (
    <View style={s.root}>
      <View style={s.headerRow}>
        <Text style={[s.title, d.secondary]}>
          {t('messages.groups.membersSection', { defaultValue: '选择会话' })}
        </Text>
        <Text style={[s.count, d.secondary]}>
          {t('messages.groups.selectedCount', {
            defaultValue: '已选 {{count}} 个',
            count: selectedCount,
          })}
        </Text>
      </View>
      <View style={[s.searchBox, d.field]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.input]}
          value={query}
          onChangeText={onChangeQuery}
          placeholder={t('messages.groups.searchPlaceholder', { defaultValue: '搜索群聊或私聊' })}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <Pressable
            onPress={() => onChangeQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
          >
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <View style={s.chips} accessibilityRole="tablist">
        {FILTERS.map((item) => {
          const active = filter === item.id;
          return (
            <Pressable
              key={item.id}
              style={[s.chip, d.field, active ? d.chipActive : null]}
              onPress={() => onChangeFilter(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.chipText, active ? d.chipTextActive : d.secondary]}>
                {t(item.key, { defaultValue: item.fallback })}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.bulkRow}>
        <Text style={[s.count, d.secondary]}>
          {t('messages.groups.resultCount', { defaultValue: '{{count}} 个结果', count: resultCount })}
        </Text>
        <Pressable onPress={onToggleResults} disabled={bulkDisabled} accessibilityRole="button" hitSlop={8}>
          <Text style={[s.bulkText, d.link, bulkDisabled ? s.disabled : null]}>
            {allResultsSelected
              ? t('messages.groups.deselectResults', { defaultValue: '取消当前结果' })
              : t('messages.groups.selectResults', { defaultValue: '选择全部结果' })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});
