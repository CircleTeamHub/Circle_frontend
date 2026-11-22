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
  saveLocalNoteDraft,
  type InterruptedNoteContent,
  type NoteEditorDraftRecord,
} from './note-editor-drafts';
import {
  noteSubmissionMatchesResult,
  noteUpdateResultMatchesTarget,
} from './note-submission';

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
  updatedAt: number;
  local?: NoteEditorDraftRecord;
}

export type ResumeDraft = { draftId: string; noteId: string | null };
type RecoveryResult = { published: number; resumeDraft: ResumeDraft | null };

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
    return [{
      content: record,
      noteId: record.pendingSubmission ? record.pendingSubmission.noteId : record.noteId,
      updatedAt: record.updatedAt,
      local: record,
    }];
  });
}

async function remoteTargets(userId: string, skip: ReadonlySet<string>, now: number, isCurrent: () => boolean): Promise<RecoveryTarget[]> {
  const summaries = await fetchNoteDrafts();
  const targets: RecoveryTarget[] = [];
  for (const summary of summaries) {
    if (!isCurrent()) break;
    if (skip.has(summary.id) || openEditors.has(summary.id) || isLocalNoteDraftDeleted(userId, summary.id)) continue;
    if (now - new Date(summary.updatedAt).getTime() < REMOTE_DRAFT_IDLE_MS) continue;
    const draft = await fetchNoteDraft(summary.id);
    if (now - new Date(draft.updatedAt).getTime() < REMOTE_DRAFT_IDLE_MS) continue;
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
      updatedAt: Date.parse(draft.updatedAt),
    });
  }
  return targets;
}

let running: { userId: string; isCurrent: () => boolean; work: Promise<RecoveryResult> } | null = null;

/**
 * 把被打断的编辑存成笔记，也返回需要回编辑器处理的本机草稿。
 * 单条失败不影响其余的，记录留着，下次回到笔记页再试。
 */
export function publishInterruptedNotes(options: {
  userId: string;
  /** 没写标题时用的标题（「未命名笔记」）。 */
  fallbackTitle: string;
  /** 换了账号 / 会话就停。 */
  isCurrent: () => boolean;
  now?: number;
}): Promise<RecoveryResult> {
  if (running?.userId === options.userId && running.isCurrent()) return running.work;
  const work = run(options).finally(() => {
    if (running?.work === work) running = null;
  });
  running = { userId: options.userId, isCurrent: options.isCurrent, work };
  return work;
}

async function run({
  userId,
  fallbackTitle,
  isCurrent,
  now = Date.now(),
}: Parameters<typeof publishInterruptedNotes>[0]): Promise<RecoveryResult> {
  await retryDraftDeletions(userId, isCurrent);
  const result: RecoveryResult = { published: 0, resumeDraft: null };
  if (!isCurrent()) return result;
  const local = localTargets(userId);
  let remote: RecoveryTarget[] = [];
  const remoteDue = !lastRemoteCheck || lastRemoteCheck.userId !== userId ||
    now - lastRemoteCheck.at >= REMOTE_CHECK_INTERVAL_MS || now < lastRemoteCheck.at;
  if (remoteDue) {
    try {
      remote = await remoteTargets(userId, new Set(local.map((target) => target.content.id)), now, isCurrent);
      if (isCurrent()) lastRemoteCheck = { userId, at: now };
    } catch (error) {
      // 拉不到服务端草稿不影响本机这些；下次回来再看。
      reportHandledFailure('noteRecovery', 'loadRemoteDrafts', error);
    }
  }
  for (const target of [...local, ...remote]) {
    if (!isCurrent()) break;
    const draftId = target.content.id;
    if (openEditors.has(draftId)) continue;
    const pending = target.local?.pendingSubmission;
    if (pending?.conflictingNoteId || target.local?.audioItems.some((item) => item.uploadStatus !== 'UPLOADED')) {
      result.resumeDraft ??= { draftId, noteId: target.noteId };
      continue;
    }
    if (!pending && !interruptedNoteHasContent(target.content)) {
      // 只打开过、什么都没写：没有可存的，记录直接清掉。
      removeLocalNoteDraft(userId, draftId);
      void deleteNoteDraft(draftId).catch((error) => reportHandledFailure('noteRecovery', 'emptyDraftDelete', error));
      continue;
    }
    try {
      const input = pending?.input ?? interruptedNoteToInput(target.content, fallbackTitle);
      // 普通更新保留置顶，已发出的提交则原样重放。详情 404 可能是回收站里的笔记，不能另建一篇。
      const current = target.noteId && !pending ? await fetchNoteDetail(target.noteId) : null;
      if (!isCurrent()) break;
      // 本机草稿比的是编辑开始时笔记的服务端版本，不比手机时钟；之前存下、没记版本的才退回比草稿时间。
      // 服务端草稿的 updatedAt 本来就是服务端时间。
      const editStartedAt = target.local?.baseNoteUpdatedAt ? Date.parse(target.local.baseNoteUpdatedAt) : target.updatedAt;
      if (current && Date.parse(current.updatedAt) > editStartedAt) {
        // 笔记在这份草稿之后又存过：草稿已作废。不拿它覆盖新版，也不再每次都提示「继续编辑」。
        removeLocalNoteDraft(userId, draftId);
        void deleteNoteDraft(draftId).catch((error) => reportHandledFailure('noteRecovery', 'staleDraftDelete', error));
        continue;
      }
      const saved = target.noteId
        ? await updateNote(target.noteId, current ? { ...input, pinned: current.pinned } : input)
        : await createNote(pending ? input : { ...input, status: 'ACTIVE' });
      if (!isCurrent()) break;
      if (pending && target.local && !(pending.noteId
        ? noteUpdateResultMatchesTarget(pending, saved)
        : noteSubmissionMatchesResult(pending, saved))) {
        saveLocalNoteDraft(userId, {
          ...target.local,
          pendingSubmission: { ...pending, conflictingNoteId: saved?.id },
        });
        result.resumeDraft ??= { draftId, noteId: target.noteId };
        reportHandledFailure('noteRecovery', 'publish', new Error('Note submission outcome differs from the saved snapshot'));
        continue;
      }
      removeLocalNoteDraft(userId, draftId);
      result.published += 1;
      // 新建/更新时服务端已经按 clientDraftID 消费了草稿；这里只是兜底清理，失败不要紧。
      void deleteNoteDraft(draftId).catch((error) => reportHandledFailure('noteRecovery', 'consumedDraftDelete', error));
    } catch (error) {
      if (target.noteId && error instanceof ApiError && error.status === 404) continue;
      reportHandledFailure('noteRecovery', 'publish', error);
    }
  }
  return result;
}
