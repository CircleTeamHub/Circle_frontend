/** 编辑分组页的草稿：改名、显示开关、会话成员都先改在本地，点「保存」才写服务端。 */
export interface GroupDraft {
  name: string;
  pinnedToTabs: boolean;
  conversationIDs: readonly string[];
}

export interface GroupDraftChanges {
  patch: { name?: string; pinnedToTabs?: boolean };
  /** 成员集合有变化时是完整的新列表（服务端整表替换语义），没变是 null。 */
  conversationIDs: string[] | null;
}

/** 新建分组的起点：默认显示在消息页顶部。 */
export const EMPTY_GROUP_DRAFT: GroupDraft = {
  name: '',
  pinnedToTabs: true,
  conversationIDs: [],
};

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

/** 和已保存的分组比，算出要发的改动；会和保存失败后的重试共用（只补发没成功的部分）。 */
export function diffGroupDraft(saved: GroupDraft, draft: GroupDraft): GroupDraftChanges {
  const patch: GroupDraftChanges['patch'] = {};
  const name = draft.name.trim();
  if (name !== saved.name) patch.name = name;
  if (draft.pinnedToTabs !== saved.pinnedToTabs) patch.pinnedToTabs = draft.pinnedToTabs;
  return {
    patch,
    conversationIDs: sameMembers(saved.conversationIDs, draft.conversationIDs)
      ? null
      : [...new Set(draft.conversationIDs)],
  };
}

export function hasGroupDraftChanges(changes: GroupDraftChanges): boolean {
  return Object.keys(changes.patch).length > 0 || changes.conversationIDs !== null;
}
