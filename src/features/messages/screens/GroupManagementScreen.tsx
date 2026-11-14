import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useDragReorder } from '@/hooks/use-drag-reorder';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { useGroupTabOrder } from '@/features/messages/hooks/use-group-tab-order';
import {
  GROUP_ORDER_ROW_STRIDE,
  GroupOrderRow,
} from '@/features/messages/components/group-order-row';
import {
  groupIdFromFilterId,
  reorderMessageFilter,
} from '@/features/messages/utils/message-filter-order';

const GROUP_EDIT_PATH = '/(tabs)/messages/group-edit';

const s = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  hint: { ...Typography.small },
  // 拖动中的行要压在兄弟行上面（zIndex 只在兄弟之间生效），FlatList 每行包一层
  // cell 容器会让它失效；条数也就固定标签 + 分组，直接平铺。
  list: { gap: Spacing.sm },
  footerText: { ...Typography.small, textAlign: 'center' },
  retry: { ...Typography.small, fontWeight: '600', textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  createButton: {
    height: 48,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  createText: { ...Typography.body, fontWeight: '600' },
});

export default function GroupManagementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const loading = useMessageGroupsStore((state) => state.loading);
  const error = useMessageGroupsStore((state) => state.error);
  const loadGroups = useMessageGroupsStore((state) => state.load);
  const { order, groupsById, commitOrder, reordering } = useGroupTabOrder();
  const { orderedIds, draggingId, dragY, getHandlers } = useDragReorder({
    ids: order,
    rowStride: GROUP_ORDER_ROW_STRIDE,
    onCommit: commitOrder,
    disabled: reordering,
  });

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background, paddingTop: insets.top },
      secondary: { color: colors.textSecondary },
      error: { color: colors.error },
      link: { color: colors.primary },
      footer: { paddingBottom: insets.bottom + Spacing.md },
      createButton: { backgroundColor: colors.primary },
      createText: { color: colors.white },
    }),
    [colors, insets.bottom, insets.top],
  );

  const builtInLabels = useMemo<Record<string, string>>(
    () => ({
      all: t('messages.all'),
      unread: t('messages.unread'),
      group: t('messages.group'),
      private: t('messages.private'),
    }),
    [t],
  );

  const handleMove = useCallback(
    (id: string, offset: number) => {
      if (reordering) return;
      const next = reorderMessageFilter(order, id, order.indexOf(id) + offset);
      if (next !== order) commitOrder(next);
    },
    [commitOrder, order, reordering],
  );
  const openGroup = useCallback(
    (filterId: string) => {
      const id = groupIdFromFilterId(filterId);
      if (id) router.push({ pathname: GROUP_EDIT_PATH, params: { id } });
    },
    [router],
  );
  const createGroup = useCallback(() => router.push(GROUP_EDIT_PATH), [router]);
  const retryLoad = useCallback(() => void loadGroups(), [loadGroups]);

  return (
    <View style={d.container}>
      <NavHeader title={t('messages.groups.title', { defaultValue: '分组管理' })} />
      <ScrollView
        contentContainerStyle={s.content}
        scrollEnabled={!draggingId}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.hint, d.secondary]}>
          {t('messages.groups.orderHint', {
            defaultValue: '按住 ≡ 拖动排序，消息页顶部标签按这个顺序显示。点自定义分组可以改名、选会话。',
          })}
        </Text>
        <View style={s.list}>
          {orderedIds.map((id, index) => {
            const groupId = groupIdFromFilterId(id);
            const group = groupId ? groupsById.get(groupId) : undefined;
            const count = group
              ? t('messages.groups.conversationCount', {
                  defaultValue: '{{count}} 个会话',
                  count: group.conversationIDs.length,
                })
              : '';
            const subtitle = !group
              ? t('messages.groups.builtInGroup', { defaultValue: '默认标签' })
              : group.pinnedToTabs
                ? count
                : `${count} · ${t('messages.groups.hiddenFromTabs', { defaultValue: '未在消息页显示' })}`;
            return (
              <GroupOrderRow
                key={id}
                id={id}
                label={group?.name ?? builtInLabels[id] ?? id}
                subtitle={subtitle}
                muted={group ? !group.pinnedToTabs : false}
                dragging={draggingId === id}
                dimmed={draggingId !== null && draggingId !== id}
                dragY={dragY}
                dragHandlers={getHandlers(id)}
                position={index + 1}
                total={orderedIds.length}
                onMove={handleMove}
                onPress={group ? openGroup : undefined}
              />
            );
          })}
        </View>
        {error ? (
          <Pressable onPress={retryLoad} accessibilityRole="button">
            <Text style={[s.footerText, d.error]}>{error}</Text>
            <Text style={[s.retry, d.link]}>
              {t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
        ) : !loading && groupsById.size === 0 ? (
          <Text style={[s.footerText, d.secondary]}>
            {t('messages.groups.emptyHint', {
              defaultValue: '新建分组，把常联系的群聊和私聊归到一起。',
            })}
          </Text>
        ) : null}
      </ScrollView>
      <View style={[s.footer, d.footer]}>
        <Pressable
          style={[s.createButton, d.createButton]}
          onPress={createGroup}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={20} color={colors.white} />
          <Text style={[s.createText, d.createText]}>
            {t('messages.groups.create', { defaultValue: '新建分组' })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
