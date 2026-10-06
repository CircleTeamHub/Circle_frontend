/**
 * 聊天输入框草稿的纯模型(持久化 store 见 composer-drafts.ts)。
 * 不依赖存储与框架,方便单测。
 */

export interface ComposerDraftMention {
  userID: string;
  nickname: string;
  isAll?: boolean;
}

export interface ComposerDraft {
  text: string;
  /** 正在引用回复的那条消息;恢复时在时间线里找得到才还原。 */
  quoteMessageId: string | null;
  mentions: ComposerDraftMention[];
  /** 最后一次编辑的时刻(epoch ms),超出条数上限时按它淘汰最旧的。 */
  updatedAt: number;
}

/** 每个账号最多留多少个会话的草稿:防止长期使用把 MMKV 撑大。 */
export const COMPOSER_DRAFTS_PER_ACCOUNT_MAX = 200;

/** 会话列表里草稿预览的最大字数。 */
const DRAFT_PREVIEW_MAX_LENGTH = 60;

export function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return draft.text.trim().length === 0 && !draft.quoteMessageId;
}

export function draftPreviewText(draft: ComposerDraft): string {
  const oneLine = draft.text.replace(/\s+/g, ' ').trim();
  return oneLine.length > DRAFT_PREVIEW_MAX_LENGTH
    ? oneLine.slice(0, DRAFT_PREVIEW_MAX_LENGTH)
    : oneLine;
}

export function pruneComposerDrafts(
  drafts: Record<string, ComposerDraft>,
): Record<string, ComposerDraft> {
  const entries = Object.entries(drafts);
  if (entries.length <= COMPOSER_DRAFTS_PER_ACCOUNT_MAX) return drafts;
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(entries.slice(0, COMPOSER_DRAFTS_PER_ACCOUNT_MAX));
}
