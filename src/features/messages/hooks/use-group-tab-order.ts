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
 * 整条顺序存本地 filterOrder；分组之间的相对顺序同时写回服务端 sortOrder。
 */
export function useGroupTabOrder() {
  const { t } = useTranslation();
  const groups = useMessageGroupsStore((state) => state.groups);
  const filterOrder = useMessageGroupsStore((state) => state.filterOrder);
  const setFilterOrder = useMessageGroupsStore((state) => state.setFilterOrder);
  const reorderGroups = useMessageGroupsStore((state) => state.reorder);
  const [reordering, setReordering] = useState(false);

  const order = useMemo(
    () => buildManagedFilterOrder(groups.map((group) => group.id), filterOrder),
    [filterOrder, groups],
  );
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const commitOrder = useCallback(
    (nextOrder: string[]) => {
      const previousStored = useMessageGroupsStore.getState().filterOrder;
      setFilterOrder(nextOrder);
      const groupIds = changedGroupOrder(order, nextOrder);
      if (!groupIds) return;
      setReordering(true);
      reorderGroups(groupIds)
        .catch(() => {
          // 服务端没存上就整条退回去，免得界面显示的顺序和提示「失败」对不上。
          setFilterOrder(previousStored);
          Alert.alert(
            t('messages.groups.reorderFailedTitle', { defaultValue: '排序失败' }),
            t('messages.groups.reorderFailedMessage', {
              defaultValue: '分组顺序保存失败，请稍后再试。',
            }),
          );
        })
        .finally(() => setReordering(false));
    },
    [order, reorderGroups, setFilterOrder, t],
  );

  return { order, groupsById, commitOrder, reordering };
}
