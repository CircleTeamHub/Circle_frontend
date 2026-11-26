import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import {
  buildManagedFilterOrder,
  changedGroupOrder,
} from '@/features/messages/utils/message-filter-order';

/**
 * 分组管理页唯一的排序：固定标签和自定义分组在同一条列表里排，
 * 顺序就是消息页顶部标签的顺序（隐藏的分组也占位，重新显示时回到原位）。
 * 调整先留在页面里，点保存才写本地 filterOrder 和服务端 sortOrder。
 */
export function useGroupTabOrder() {
  const { t } = useTranslation();
  const groups = useMessageGroupsStore((state) => state.groups);
  const filterOrder = useMessageGroupsStore((state) => state.filterOrder);
  const setFilterOrder = useMessageGroupsStore((state) => state.setFilterOrder);
  const reorderGroups = useMessageGroupsStore((state) => state.reorder);
  const [reordering, setReordering] = useState(false);
  const [draftOrder, setOrder] = useState<string[] | null>(null);

  const order = useMemo(
    () => buildManagedFilterOrder(groups.map((group) => group.id), draftOrder ?? filterOrder),
    [draftOrder, filterOrder, groups],
  );
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const commitOrder = useCallback(
    async () => {
      const previousStored = useMessageGroupsStore.getState().filterOrder;
      const previousOrder = buildManagedFilterOrder(groups.map((group) => group.id), previousStored);
      setFilterOrder(order);
      const groupIds = changedGroupOrder(previousOrder, order);
      if (!groupIds) return true;
      setReordering(true);
      try {
        await reorderGroups(groupIds);
        return true;
      } catch {
        setFilterOrder(previousStored);
        Alert.alert(
          t('messages.groups.reorderFailedTitle', { defaultValue: '排序失败' }),
          t('messages.groups.reorderFailedMessage', {
            defaultValue: '分组顺序保存失败，请稍后再试。',
          }),
        );
        return false;
      } finally {
        setReordering(false);
      }
    },
    [groups, order, reorderGroups, setFilterOrder, t],
  );

  return { order, groupsById, setOrder, commitOrder, reordering };
}
