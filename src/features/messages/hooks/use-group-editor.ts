import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  EMPTY_GROUP_DRAFT,
  diffGroupDraft,
  hasGroupDraftChanges,
} from '@/features/messages/utils/group-edit-draft';
import type { CustomConversationGroup } from '@/types';

/**
 * 新建 / 编辑分组的草稿与保存。名称、显示开关、会话成员都先改在本地，
 * save() 只发真正变了的部分：先建组或 PATCH，再整表替换成员。
 * 中途失败时已成功的部分已经进了 store，再点保存只补发剩下的。
 */
export function useGroupEditor(initialGroupId: string | null) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState(initialGroupId);
  const selectGroup = useCallback(
    (state: { groups: CustomConversationGroup[] }) =>
      groupId ? (state.groups.find((group) => group.id === groupId) ?? null) : null,
    [groupId],
  );
  const group = useMessageGroupsStore(selectGroup);
  const createGroup = useMessageGroupsStore((state) => state.create);
  const updateGroup = useMessageGroupsStore((state) => state.update);
  const setMembers = useMessageGroupsStore((state) => state.setMembers);
  const removeGroup = useMessageGroupsStore((state) => state.remove);

  // 只在打开时判断「分组不存在」：编辑中被删（含本页的删除）不切走表单，避免退场时闪一下。
  const [missing] = useState(() => initialGroupId !== null && group === null);
  const [name, setName] = useState(group?.name ?? '');
  const [pinnedToTabs, setPinnedToTabs] = useState(group?.pinnedToTabs ?? true);
  const [conversationIDs, setConversationIDs] = useState<string[]>(
    () => group?.conversationIDs ?? [],
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const changes = useMemo(
    () => diffGroupDraft(group ?? EMPTY_GROUP_DRAFT, { name, pinnedToTabs, conversationIDs }),
    [conversationIDs, group, name, pinnedToTabs],
  );
  const dirty = hasGroupDraftChanges(changes);
  const canSave = dirty && name.trim().length > 0 && !saving;

  const save = useCallback(async (): Promise<boolean> => {
    const trimmed = name.trim();
    if (savingRef.current || !trimmed) return false;
    savingRef.current = true;
    setSaving(true);
    let targetId = groupId;
    try {
      if (!targetId) {
        const created = await createGroup({ name: trimmed, pinnedToTabs });
        targetId = created.id;
        setGroupId(created.id);
      } else if (Object.keys(changes.patch).length > 0) {
        await updateGroup(targetId, changes.patch);
      }
      if (changes.conversationIDs) await setMembers(targetId, changes.conversationIDs);
      return true;
    } catch (err) {
      const createdJustNow = groupId === null && targetId !== null;
      Alert.alert(
        t('messages.groups.saveFailed', { defaultValue: '保存失败' }),
        createdJustNow
          ? t('messages.groups.membersFailedAfterCreate', {
              defaultValue: '分组已建好，但会话没能加进去，请再点一次保存。',
            })
          : getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [changes, createGroup, groupId, name, pinnedToTabs, setMembers, t, updateGroup]);

  const remove = useCallback(async () => {
    if (!groupId) return;
    try {
      await removeGroup(groupId);
    } catch (err) {
      Alert.alert(
        t('messages.groups.deleteFailed', { defaultValue: '删除失败' }),
        getApiErrorMessage(err, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
    }
  }, [groupId, removeGroup, t]);

  return {
    isNew: groupId === null,
    /** 打开时分组已被删掉（另一台设备删的、已同步过来）。 */
    missing,
    savedName: group?.name ?? '',
    name,
    setName,
    pinnedToTabs,
    setPinnedToTabs,
    conversationIDs,
    setConversationIDs,
    dirty,
    canSave,
    saving,
    save,
    remove,
  };
}
