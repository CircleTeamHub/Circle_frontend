import { ApiError } from '@/services/api/api-error';
import {
  createNote,
  deleteNoteDraft,
  fetchNoteDetail,
  fetchNoteDraft,
  fetchNoteDrafts,
  updateNote,
} from '@/services/api/notes';
import { reportHandledFailure } from '@/observability/report-failure';
import type { CreateNoteInput, NoteDetail } from '@/features/notes/types';
import {
  confirmNoteDraftDeletion,
  finishLocalNoteDraftDeletion,
  interruptedNoteHasContent,
  interruptedNoteToInput,
  isLocalNoteDraftDeleted,
  loadLocalNoteDraft,
  loadLocalNoteDraftSummaries,
  loadPendingNoteDraftDeletions,
  removeLocalNoteDraft,
  type InterruptedNoteContent,
} from './note-editor-drafts';

/**
 * 草稿箱取消以后，编辑到一半被打断的内容（闪退、被系统杀掉、退出时没存成）一律存成笔记。
 *
 * 编辑页的自动保存（本机快照 + 服务端草稿）就是记录。回到「我的笔记」时把剩下的逐条发布，
 * 发布成功就删掉记录；clientDraftID 沿用草稿 id，服务端发布时一并消费同名草稿，重放也只会
 * 得到同一篇笔记。
 */

/** 编辑页还开着的草稿：还在被编辑，不能替它发布。计数（同一份可能在两个 tab 栈里各开一页）。 */
const openEditors = new Map<string, number>();

export function trackOpenNoteEditor(draftId: string): () => void {
  openEditors.set(draftId, (openEditors.get(draftId) ?? 0) + 1);
  return () => {
    const count = (openEditors.get(draftId) ?? 1) - 1;
    if (count > 0) openEditors.set(draftId, count);
    else openEditors.delete(draftId);
  };
}

/** 服务端草稿可能正在另一台设备上编辑：只接手放了这么久没动的。 */
export const REMOTE_DRAFT_IDLE_MS = 30 * 60_000;
/** 每次回到笔记页都会跑；服务端草稿这一步要发请求，隔这么久才看一次。 */
const REMOTE_CHECK_INTERVAL_MS = 10 * 60_000;
let lastRemoteCheck: { userId: string; at: number } | null = null;

interface RecoveryTarget {
  content: InterruptedNoteContent;
  /** 编辑的是已有笔记时它的 id。 */
  noteId: string | null;
  /** 闪退前已经发出、结果未知的那次提交：原样重放，不能换成更新的内容。 */
  pendingInput?: CreateNoteInput;
}

async function publishOne(target: RecoveryTarget, fallbackTitle: string): Promise<NoteDetail> {
  const input = target.pendingInput ?? interruptedNoteToInput(target.content, fallbackTitle);
  if (target.noteId) {
    // PATCH 是整份替换：不带 pinned 就是取消置顶，所以先读出当前值。
    let current: NoteDetail | null = null;
    try {
      current = await fetchNoteDetail(target.noteId);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    // 要更新的那篇已经不在了（被彻底删除）：内容另存成一篇新笔记，不丢。
    if (current) return updateNote(target.noteId, { ...input, pinned: input.pinned ?? current.pinned });
  }
  const { pinned: _pinned, ...createInput } = input;
  return createNote({ ...createInput, status: 'ACTIVE' });
}

async function retryDraftDeletions(userId: string, isCurrent: () => boolean) {
  // 逐条来:断网时不要一下子打出一串 DELETE。
  for (const id of loadPendingNoteDraftDeletions(userId)) {
    if (!isCurrent()) return;
    try {
      const cleaned = await finishLocalNoteDraftDeletion(userId, id);
      if (!isCurrent()) return;
      await deleteNoteDraft(id);
      if (isCurrent()) confirmNoteDraftDeletion(userId, id, cleaned);
    } catch (error) {
      reportHandledFailure('noteRecovery', 'draftDeleteRetry', error);
    }
  }
}

function localTargets(userId: string): RecoveryTarget[] {
  return loadLocalNoteDraftSummaries(userId).flatMap((summary): RecoveryTarget[] => {
    if (openEditors.has(summary.id)) return [];
    const record = loadLocalNoteDraft(userId, summary.id);
    if (!record) return [];
    // 服务端回过一篇对不上号的笔记:结果说不清,留着这份记录,不再自动重放。
    if (record.pendingSubmission?.conflictingNoteId) return [];
    return [{
      content: record,
      noteId: record.pendingSubmission ? record.pendingSubmission.noteId : record.noteId,
      ...(record.pendingSubmission ? { pendingInput: record.pendingSubmission.input } : {}),
    }];
  });
}

async function remoteTargets(userId: string, skip: ReadonlySet<string>, now: number): Promise<RecoveryTarget[]> {
  const summaries = await fetchNoteDrafts();
  const targets: RecoveryTarget[] = [];
  for (const summary of summaries) {
    if (skip.has(summary.id) || openEditors.has(summary.id) || isLocalNoteDraftDeleted(userId, summary.id)) continue;
    if (now - new Date(summary.updatedAt).getTime() < REMOTE_DRAFT_IDLE_MS) continue;
    const draft = await fetchNoteDraft(summary.id);
    targets.push({
      content: {
        id: draft.id,
        title: draft.title,
        content: draft.content ?? '',
        contentJson: draft.contentJson ?? [],
        sections: draft.sections ?? {},
        groupIds: draft.groupIds,
        mediaKeys: draft.mediaKeys,
        city: draft.city ?? null,
      },
      noteId: draft.sourceNoteId ?? null,
    });
  }
  return targets;
}

let running: Promise<number> | null = null;

/**
 * 把被打断的编辑存成笔记，返回存成了几篇。单飞：并发调用拿到同一次的结果。
 * 单条失败不影响其余的，记录留着，下次回到笔记页再试。
 */
export function publishInterruptedNotes(options: {
  userId: string;
  /** 没写标题时用的标题（「未命名笔记」）。 */
  fallbackTitle: string;
  /** 换了账号 / 会话就停。 */
  isCurrent: () => boolean;
  now?: number;
}): Promise<number> {
  running ??= run(options).finally(() => {
    running = null;
  });
  return running;
}

async function run({
  userId,
  fallbackTitle,
  isCurrent,
  now = Date.now(),
}: Parameters<typeof publishInterruptedNotes>[0]): Promise<number> {
  await retryDraftDeletions(userId, isCurrent);
  const local = localTargets(userId);
  let remote: RecoveryTarget[] = [];
  const remoteDue = !lastRemoteCheck || lastRemoteCheck.userId !== userId ||
    now - lastRemoteCheck.at >= REMOTE_CHECK_INTERVAL_MS || now < lastRemoteCheck.at;
  if (remoteDue) {
    try {
      remote = await remoteTargets(userId, new Set(local.map((target) => target.content.id)), now);
      lastRemoteCheck = { userId, at: now };
    } catch (error) {
      // 拉不到服务端草稿不影响本机这些；下次回来再看。
      reportHandledFailure('noteRecovery', 'loadRemoteDrafts', error);
    }
  }
  let published = 0;
  for (const target of [...local, ...remote]) {
    if (!isCurrent()) break;
    const draftId = target.content.id;
    if (openEditors.has(draftId)) continue;
    if (!target.pendingInput && !interruptedNoteHasContent(target.content)) {
      // 只打开过、什么都没写：没有可存的，记录直接清掉。
      removeLocalNoteDraft(userId, draftId);
      void deleteNoteDraft(draftId).catch((error) => reportHandledFailure('noteRecovery', 'emptyDraftDelete', error));
      continue;
    }
    try {
      await publishOne(target, fallbackTitle);
      if (!isCurrent()) break;
      removeLocalNoteDraft(userId, draftId);
      published += 1;
      // 新建/更新时服务端已经按 clientDraftID 消费了草稿；这里只是兜底清理，失败不要紧。
      void deleteNoteDraft(draftId).catch((error) => reportHandledFailure('noteRecovery', 'consumedDraftDelete', error));
    } catch (error) {
      reportHandledFailure('noteRecovery', 'publish', error);
    }
  }
  return published;
}
