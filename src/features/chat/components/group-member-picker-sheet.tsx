import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import type { ChatMemberDto } from '@/chat-core/protocol';
import {
  groupMemberDisplayName,
  groupMemberMatchesQuery,
} from '@/features/chat/group-member-display';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface GroupMemberPickerSheetProps {
  visible: boolean;
  title: string;
  /** 调用方已按权限筛过的候选(不含自己、不含无权操作的角色)。 */
  members: readonly ChatMemberDto[];
  onSelect: (member: ChatMemberDto) => void;
  multiSelect?: boolean;
  selectedMemberIDs?: ReadonlySet<string>;
  onToggle?: (member: ChatMemberDto) => void;
  onConfirm?: () => void;
  onClose: () => void;
}

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  searchWrap: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, padding: 0 },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  confirmText: {
    ...Typography.body,
    fontWeight: '600',
  },
  rowText: { flex: 1, gap: 2 },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
});

/** 群管理的选人面板(支持单选/多选、带搜索)。 */
export function GroupMemberPickerSheet({
  visible,
  title,
  members,
  onSelect,
  multiSelect = false,
  selectedMemberIDs,
  onToggle,
  onConfirm,
  onClose,
}: GroupMemberPickerSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return members;
    return members.filter((member) => groupMemberMatchesQuery(member, keyword));
  }, [members, query]);

  const d = useMemo(
    () => ({
      sheet: { backgroundColor: colors.surface },
      title: { color: colors.text, ...Typography.h3 },
      confirm: { color: colors.primary },
      search: { backgroundColor: colors.background },
      input: { color: colors.text, ...Typography.bodyRegular },
      name: { color: colors.text, ...Typography.body },
      meta: { color: colors.textSecondary, ...Typography.small },
      empty: { color: colors.textSecondary, ...Typography.bodyRegular },
    }),
    [colors],
  );

  const renderItem = ({ item }: ListRenderItemInfo<ChatMemberDto>) => {
    const name = groupMemberDisplayName(item);
    const checked = selectedMemberIDs?.has(item.userId) ?? false;
    const role =
      item.role === 'OWNER'
        ? t('chat.groupOwner')
        : item.role === 'ADMIN'
          ? t('chat.groupAdmin')
          : '';
    return (
      <Pressable
        style={s.row}
        onPress={() => {
          if (multiSelect) {
            onToggle?.(item);
          } else {
            onSelect(item);
          }
        }}
        accessibilityRole={multiSelect ? 'checkbox' : 'button'}
        accessibilityState={multiSelect ? { checked } : undefined}
        accessibilityLabel={name}
      >
        <Avatar size={40} shape="square" name={name} uri={item.avatarUrl ?? undefined} />
        <View style={s.rowText}>
          <Text style={d.name} numberOfLines={1}>
            {name}
          </Text>
          {role ? (
            <Text style={d.meta} numberOfLines={1}>
              {role}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={multiSelect ? (checked ? 'checkmark-circle' : 'ellipse-outline') : 'chevron-forward'}
          size={multiSelect ? 22 : 18}
          color={checked ? colors.iconAccent : colors.textSecondary}
        />
      </Pressable>
    );
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose} sheetStyle={[s.sheet, d.sheet]}>
      <View style={s.header}>
        <Text style={d.title}>{title}</Text>
        <View style={s.headerActions}>
          {multiSelect ? (
            <Pressable
              onPress={onConfirm}
              hitSlop={8}
              disabled={!selectedMemberIDs || selectedMemberIDs.size === 0}
              accessibilityRole="button"
              accessibilityLabel={t('common.done')}
            >
              <Text
                style={[
                  s.confirmText,
                  d.confirm,
                  !selectedMemberIDs || selectedMemberIDs.size === 0
                    ? { opacity: 0.4 }
                    : null,
                ]}
              >
                {t('common.done')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
      <View style={[s.searchWrap, d.search]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, d.input]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('chat.groupManagement.searchPlaceholder', {
            defaultValue: '搜索成员',
          })}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.userId}
        renderItem={renderItem}
        contentContainerStyle={s.listContent}
        {...keyboardDismissOnDragProps}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={d.empty}>
              {t('chat.groupManagement.noCandidates', {
                defaultValue: '没有可选择的成员',
              })}
            </Text>
          </View>
        }
      />
    </BottomSheetModal>
  );
}
