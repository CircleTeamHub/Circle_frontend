import { Ionicons } from '@expo/vector-icons';
import { type Ref, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { ChatTargetRow } from './ChatTargetRow';
import { ChatTargetTabs, type ChatTargetTabOption } from './ChatTargetTabs';
import { RecentForwardStrip } from './RecentForwardStrip';
import type { ChatTarget } from './types';
import {
  searchChatTargets,
  useChatTargetSources,
  type ChatTargetTab,
} from './use-chat-target-sources';
import { useRecentForwardTargetsStore } from './use-recent-forward-targets-store';

/** 多选一次最多发给几个聊天,和笔记批量分享的上限一致。 */
export const CHAT_TARGET_MAX_SELECTION = 9;

export interface ChatTargetPickerHandle {
  /** 部分发送失败后,把已经发出去的对象从多选里去掉:再点「发送」只发给剩下的,不会重复发。 */
  deselect: (keys: readonly string[]) => void;
}

interface ChatTargetPickerProps {
  ref?: Ref<ChatTargetPickerHandle>;
  title?: string;
  /** 发送中锁住选择,防止重复点。 */
  busy?: boolean;
  /** 发送中仍允许关闭(调用方关掉即停发剩余内容),默认发送中连关闭也锁住。 */
  closableWhileBusy?: boolean;
  onClose: () => void;
  /** 单选点中一行、或多选点「发送」后回调;确认框和真正的发送由调用方负责。 */
  onConfirm: (targets: ChatTarget[]) => void;
}

const TABS: ChatTargetTabOption[] = [
  { id: 'recent', labelKey: 'chat.targetPicker.recentChats', fallback: '最近聊天' },
  { id: 'contacts', labelKey: 'chat.targetPicker.contacts', fallback: '通讯录' },
  { id: 'groups', labelKey: 'chat.targetPicker.groups', fallback: '我的群聊' },
];

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  headerSide: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  title: { ...Typography.h3, flex: 1, textAlign: 'center' },
  headerAction: { ...Typography.body, textAlign: 'right' },
  search: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    height: 44,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  // 行高要给足:iOS 上中文占位文字在没有 lineHeight/minHeight 的单行输入框里会被裁掉上下边。
  searchInput: {
    ...Typography.body,
    flex: 1,
    lineHeight: 20,
    minHeight: 24,
    padding: 0,
    textAlignVertical: 'center',
  },
  center: { paddingVertical: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
  hint: { ...Typography.bodyRegular, textAlign: 'center' },
  footer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  sendButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * 转发、发笔记、发名片共用的「选择一个聊天」页:搜索 + 最近转发 + 最近聊天/通讯录/我的群聊,
 * 右上角切多选。只负责选人,发不发、怎么发由调用方决定。
 */
export function ChatTargetPicker({
  ref,
  title,
  busy = false,
  closableWhileBusy = false,
  onClose,
  onConfirm,
}: ChatTargetPickerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<ChatTargetTab>('recent');
  const [query, setQuery] = useState('');
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<ChatTarget[]>([]);
  const searching = query.trim().length > 0;
  const sources = useChatTargetSources(tab, searching);
  const removeRecent = useRecentForwardTargetsStore((state) => state.remove);
  const clearRecent = useRecentForwardTargetsStore((state) => state.clear);

  const selectedKeys = useMemo(() => new Set(selected.map((target) => target.key)), [selected]);

  useImperativeHandle(
    ref,
    () => ({
      deselect: (keys) => {
        const drop = new Set(keys);
        setSelected((current) => current.filter((target) => !drop.has(target.key)));
      },
    }),
    [],
  );
  const list = searching
    ? searchChatTargets(query, [sources.recentChats, sources.contacts, sources.groups])
    : tab === 'recent'
      ? sources.recentChats
      : tab === 'contacts'
        ? sources.contacts
        : sources.groups;

  const handlePress = useCallback(
    (target: ChatTarget) => {
      if (busy) return;
      if (!multiSelect) {
        onConfirm([target]);
        return;
      }
      setSelected((current) => {
        if (current.some((item) => item.key === target.key)) {
          return current.filter((item) => item.key !== target.key);
        }
        if (current.length >= CHAT_TARGET_MAX_SELECTION) {
          Alert.alert(
            t('chat.targetPicker.limitReached', {
              count: CHAT_TARGET_MAX_SELECTION,
              defaultValue: '一次最多选 {{count}} 个聊天',
            }),
          );
          return current;
        }
        return [...current, target];
      });
    },
    [busy, multiSelect, onConfirm, t],
  );

  const toggleMultiSelect = () => {
    setMultiSelect((value) => !value);
    setSelected([]);
  };

  const emptyText = searching
    ? t('chat.targetPicker.noMatch', { defaultValue: '没有匹配的聊天' })
    : tab === 'contacts'
      ? t('chat.targetPicker.noContacts', { defaultValue: '暂无好友' })
      : tab === 'groups'
        ? t('chat.targetPicker.noGroups', { defaultValue: '暂无群聊' })
        : t('chat.targetPicker.noChats', { defaultValue: '暂无聊天' });

  const listHeader = searching ? null : (
    <>
      {sources.userId ? (
        <RecentForwardStrip
          targets={sources.recentForwards}
          selectedKeys={selectedKeys}
          onPress={handlePress}
          onRemove={(target) => removeRecent(sources.userId as string, target.key)}
          onClear={() => clearRecent(sources.userId as string)}
        />
      ) : null}
      <ChatTargetTabs tabs={TABS} active={tab} onChange={setTab} />
    </>
  );

  const listEmpty =
    !searching && tab === 'contacts' && sources.contactsLoading ? (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    ) : !searching && tab === 'contacts' && sources.contactsFailed ? (
      <View style={s.center}>
        <Text style={[s.hint, { color: colors.textSecondary }]}>
          {t('chat.targetPicker.contactsFailed', { defaultValue: '通讯录加载失败' })}
        </Text>
        <Pressable onPress={sources.retryContacts} accessibilityRole="button">
          <Text style={[Typography.body, { color: colors.primary }]}>
            {t('common.retry', { defaultValue: '重试' })}
          </Text>
        </Pressable>
      </View>
    ) : (
      <View style={s.center}>
        <Text style={[s.hint, { color: colors.textSecondary }]}>{emptyText}</Text>
      </View>
    );

  return (
    <View style={[s.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable
          style={s.headerSide}
          onPress={onClose}
          disabled={busy && !closableWhileBusy}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>
          {title ?? t('chat.targetPicker.title', { defaultValue: '选择一个聊天' })}
        </Text>
        <Pressable
          style={s.headerSide}
          onPress={toggleMultiSelect}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={[s.headerAction, { color: colors.text }]}>
            {multiSelect
              ? t('chat.targetPicker.single', { defaultValue: '单选' })
              : t('chat.targetPicker.multi', { defaultValue: '多选' })}
          </Text>
        </Pressable>
      </View>
      <View style={[s.search, { backgroundColor: colors.surface }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          style={[s.searchInput, { color: colors.text }]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('chat.targetPicker.searchPlaceholder', {
            defaultValue: '搜索好友或群聊',
          })}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <Pressable
            hitSlop={8}
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
          >
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={list}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <ChatTargetRow
            target={item}
            multiSelect={multiSelect}
            selected={selectedKeys.has(item.key)}
            disabled={busy}
            onPress={handlePress}
          />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        {...keyboardDismissOnDragProps}
      />
      {multiSelect ? (
        <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Pressable
            style={[
              s.sendButton,
              { backgroundColor: selected.length > 0 ? colors.primary : colors.surfaceBorder },
            ]}
            onPress={() => onConfirm(selected)}
            disabled={selected.length === 0 || busy}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[Typography.body, { color: colors.white }]}>
                {t('chat.targetPicker.sendSelected', {
                  count: selected.length,
                  defaultValue: '发送（{{count}}）',
                })}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
