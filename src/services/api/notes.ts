import { apiClient, ApiError } from './client';
import { collectOffsetPages, readHasMore } from './pagination';
import { allowPeerMediaUrl } from '@/services/api/utils';
import type {
  CollectNoteSource,
  CreateNoteInput,
  CreateNoteExportInput,
  CreateNoteShareLinkInput,
  ListNotesParams,
  NoteChatMediaImportResult,
  NoteChatMediaSection,
  NoteDetail,
  NoteDraftDetail,
  NoteDraftSummary,
  NoteExportResult,
  NoteGroup,
  NoteShareLink,
  NoteSummary,
  SaveNoteDraftInput,
  NoteWorkStatus,
} from '@/features/notes/types';

/** 与服务端默认页大小一致(NOTE_LIST_DEFAULT_LIMIT=500,也是上限)。 */
const NOTE_PAGE_SIZE = 500;
/** 翻页安全上限:20 页 × 500 = 1 万条笔记。 */
const NOTE_MAX_PAGES = 20;

let lastNoteMutationAt = 0;

function sanitizeNoteMediaItem<T extends Record<string, unknown>>(item: T): T {
  const next = { ...item };
  const record = next as Record<string, unknown>;
  if (typeof record.url === 'string') {
    record.url = allowPeerMediaUrl(record.url) ?? '';
  }
  if (typeof record.posterUrl === 'string') {
    record.posterUrl = allowPeerMediaUrl(record.posterUrl);
  }
  return next;
}

function sanitizeNoteSections<T extends NoteSummary>(note: T): T {
  if (!note.sections) return note;
  const sections = { ...note.sections };
  for (const key of ['media', 'showcase', 'audio'] as const) {
    const section = sections[key];
    if (section?.items) {
      sections[key] = {
        ...section,
        items: section.items.map((item) =>
          sanitizeNoteMediaItem(item as unknown as Record<string, unknown>),
        ) as unknown as typeof section.items,
      };
    }
  }
  return { ...note, sections };
}

function sanitizeNoteSummary<T extends NoteSummary>(note: T): T {
  const sanitized = sanitizeNoteSections(note);
  return {
    ...sanitized,
    cover: sanitized.cover
      ? {
          ...sanitized.cover,
          url: allowPeerMediaUrl(sanitized.cover.url) ?? '',
        }
      : null,
  };
}

function sanitizeNoteDetail(note: NoteDetail): NoteDetail {
  const sanitized = sanitizeNoteSummary(note);
  return {
    ...sanitized,
    media: note.media.map((item) =>
      sanitizeNoteMediaItem(item as unknown as Record<string, unknown>) as unknown as NoteDetail['media'][number],
    ),
  };
}

/**
 * 笔记相关的写请求(新建/编辑/删除/置顶/分组…)成功后记一笔。列表页回到前台时据此
 * 判断能不能跳过重拉:拉过之后只要改过任何东西,就必须重拉。宁可多拉,不显示旧数据。
 * 包的是 Promise 而不是 apiClient 本身:每个调用点仍然是静态路径,诊断路由覆盖照常能扫到。
 */
async function markNoteWrite<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  lastNoteMutationAt = Date.now();
  return result;
}

/** since 之后有没有成功的笔记写请求。 */
export function notesMutatedSince(since: number): boolean {
  return lastNoteMutationAt >= since;
}

/**
 * 我的笔记列表,翻到底。服务端每页最多 500 条,靠 X-Has-More 说明还有没有;只取第一页的话
 * 笔记超过 500 条的用户,后面的笔记会从列表里静默消失。
 */
export async function fetchNotes(params?: ListNotesParams): Promise<NoteSummary[]> {
  const base = new URLSearchParams();
  if (params?.status) base.set('status', params.status);
  if (params?.groupId) base.set('groupId', params.groupId);
  if (params?.search) base.set('search', params.search);
  return collectOffsetPages(
    async (page) => {
      const q = new URLSearchParams(base);
      if (page > 1) q.set('page', String(page));
      const qs = q.toString();
      const signal = { hasMore: null as boolean | null };
      const rows = await apiClient<NoteSummary[]>(`/note${qs ? `?${qs}` : ''}`, {
        onResponseHeaders: (headers) => {
          signal.hasMore = readHasMore(headers);
        },
      });
      return { rows: rows.map(sanitizeNoteSummary), hasMore: signal.hasMore };
    },
    { pageSize: NOTE_PAGE_SIZE, maxPages: NOTE_MAX_PAGES },
  );
}

export async function fetchNoteDetail(id: string): Promise<NoteDetail> {
  const note = await apiClient<NoteDetail>(`/note/${id}`);
  return sanitizeNoteDetail(note);
}

export async function fetchNoteDrafts(): Promise<NoteDraftSummary[]> {
  return apiClient<NoteDraftSummary[]>('/note/drafts');
}

export async function fetchNoteDraft(id: string): Promise<NoteDraftDetail> {
  return apiClient<NoteDraftDetail>(`/note/drafts/${encodeURIComponent(id)}`);
}

export async function saveNoteDraft(
  id: string,
  input: SaveNoteDraftInput,
): Promise<NoteDraftDetail> {
  return markNoteWrite(apiClient<NoteDraftDetail>(`/note/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: input,
  }));
}

export async function deleteNoteDraft(id: string): Promise<void> {
  await markNoteWrite(apiClient<void>(`/note/drafts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }));
}

/**
 * 把笔记指定分区的媒体复制进自己的 chat/{userId}/ 命名空间。
 * 聊天媒体消息只认发送者自己的 object key,转发笔记媒体必须先经这一步。
 */
export async function importNoteChatMedia(
  noteId: string,
  sections: NoteChatMediaSection[],
): Promise<NoteChatMediaImportResult> {
  return markNoteWrite(apiClient<NoteChatMediaImportResult>(`/note/${noteId}/chat-media`, {
    method: 'POST',
    body: { sections },
  }));
}

export async function createNote(input: CreateNoteInput): Promise<NoteDetail> {
  return markNoteWrite(apiClient<NoteDetail>('/note', { method: 'POST', body: input }));
}

export async function updateNote(id: string, input: CreateNoteInput): Promise<NoteDetail> {
  return markNoteWrite(apiClient<NoteDetail>(`/note/${id}`, { method: 'PATCH', body: input }));
}

// 仅替换 note 的 group 归属。批量调整分组成员时使用 —— 避免对每条 note 先 fetch 详情再
// 用 updateNote 整体替换（参考 review #59，N+1 解决方案）。
export async function updateNoteGroupIds(
  id: string,
  groupIds: string[],
): Promise<{ id: string; groupIds: string[] }> {
  return markNoteWrite(apiClient<{ id: string; groupIds: string[] }>(`/note/${id}/groups`, {
    method: 'PATCH',
    body: { groupIds },
  }));
}

export type CollectNoteResult = {
  note: NoteDetail;
  /** true = 本来就是自己的笔记，或此前已收藏过（幂等，不产生新副本） */
  alreadyCollected: boolean;
};

export type CollectNoteOptions = {
  /** 收藏到当前用户的私有笔记分组；null 表示未分组。 */
  targetNoteGroupId?: string | null;
  /** 收藏副本标题，服务端应在首次创建时保存。 */
  title?: string;
};

function hasCollectOptions(options?: CollectNoteOptions): boolean {
  return Boolean(
    options &&
      (options.targetNoteGroupId !== undefined || options.title?.trim()),
  );
}

/**
 * Older preprod servers expose the original /note/collect DTO and reject the
 * new title/group fields with Nest's strict whitelist validation. Keep the
 * collection flow usable while those servers roll forward: collect the copy
 * with the stable request, then apply the user's title and group through the
 * existing note update endpoints.
 */
function isUnsupportedCollectOptionsError(
  error: unknown,
  options: CollectNoteOptions,
): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  const text = `${error.message} ${JSON.stringify(error.data ?? '')}`;
  const rejectedTitle =
    Boolean(options.title?.trim()) &&
    /property\s+title\s+should\s+not\s+exist/i.test(text);
  const rejectedGroup =
    options.targetNoteGroupId !== undefined &&
    /property\s+targetNoteGroupId\s+should\s+not\s+exist/i.test(text);
  return rejectedTitle || rejectedGroup;
}

function buildLegacyCollectUpdateInput(
  note: NoteDetail,
  options: CollectNoteOptions,
): CreateNoteInput {
  const title = options.title?.trim() || note.title;
  const groupIds =
    options.targetNoteGroupId !== undefined
      ? options.targetNoteGroupId
        ? [options.targetNoteGroupId]
        : []
      : note.groups.map((group) => group.id);

  return {
    title,
    ...(note.content != null ? { content: note.content } : {}),
    ...(note.contentJson != null ? { contentJson: note.contentJson } : {}),
    ...(note.sections ? { sections: note.sections } : {}),
    groupIds,
    status: note.status === 'UNLISTED' ? 'UNLISTED' : 'ACTIVE',
    pinned: note.pinned,
    media: note.media.map((item) => ({
      type: item.type,
      objectKey: item.objectKey,
      url: item.url,
      ...(item.mimeType != null ? { mimeType: item.mimeType } : {}),
      ...(item.size != null ? { size: item.size } : {}),
      ...(item.width != null ? { width: item.width } : {}),
      ...(item.height != null ? { height: item.height } : {}),
      ...(item.durationMs != null ? { durationMs: item.durationMs } : {}),
      ...(item.posterUrl != null ? { posterUrl: item.posterUrl } : {}),
      sortOrder: item.sortOrder,
    })),
  };
}

// 聊天里收藏他人笔记 → 服务端快照复制成一条自己的笔记（带来源名片），
// 取代旧的 createCollection(type: NOTE) 收藏页方案。
export async function collectNote(
  noteId: string,
  source: CollectNoteSource,
  options?: CollectNoteOptions,
): Promise<CollectNoteResult> {
  const normalizedTitle = options?.title?.trim();
  const body = {
    noteId,
    source,
    ...(options?.targetNoteGroupId !== undefined
      ? { targetNoteGroupId: options.targetNoteGroupId }
      : {}),
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
  };

  try {
    return await markNoteWrite(apiClient<CollectNoteResult>('/note/collect', {
      method: 'POST',
      body,
    }));
  } catch (error) {
    if (!options || !hasCollectOptions(options) || !isUnsupportedCollectOptionsError(error, options)) {
      throw error;
    }

    // Do not retry arbitrary 400s. This branch is only for an older DTO that
    // explicitly rejected one of the new optional properties, so the base
    // collection request remains safe to retry and idempotent server-side.
    const result = await markNoteWrite(apiClient<CollectNoteResult>('/note/collect', {
      method: 'POST',
      body: { noteId, source },
    }));
    if (!result.note?.id) return result;

    const updated = await updateNote(
      result.note.id,
      buildLegacyCollectUpdateInput(result.note, options),
    );
    return { ...result, note: updated };
  }
}

/** 备注是笔记主人的私人标注；传 null / 空白串即清除。 */
export async function setNoteRemark(
  id: string,
  remark: string | null,
): Promise<void> {
  await markNoteWrite(apiClient<{ id: string; remark: string | null }>(`/note/${id}/remark`, {
    method: 'PATCH',
    body: { remark },
  }));
}

export async function togglePinNote(id: string, pinned: boolean): Promise<void> {
  await markNoteWrite(apiClient<{ id: string; pinned: boolean }>(`/note/${id}/pin`, {
    method: 'PATCH',
    body: { pinned },
  }));
}

export async function unlistNote(id: string): Promise<void> {
  await markNoteWrite(apiClient<{ id: string; status: 'UNLISTED' }>(`/note/${id}/status`, {
    method: 'PATCH',
    body: { status: 'UNLISTED' },
  }));
}

export async function relistNote(id: string): Promise<void> {
  await markNoteWrite(apiClient<{ id: string; status: 'ACTIVE' }>(`/note/${id}/status`, {
    method: 'PATCH',
    body: { status: 'ACTIVE' },
  }));
}

/** 老板可选的订单状态；传 null 清除状态，不影响笔记上架与转发。 */
export async function setNoteWorkStatus(
  id: string,
  workStatus: NoteWorkStatus | null,
): Promise<{ id: string; workStatus: NoteWorkStatus | null }> {
  return markNoteWrite(apiClient<{ id: string; workStatus: NoteWorkStatus | null }>(
    `/note/${id}/work-status`,
    { method: 'PATCH', body: { workStatus } },
  ));
}

export interface NoteSourceState {
  noteId: string;
  workStatus: 'WORKING' | 'CLOSED' | 'UNSET';
  /** UNLISTED 也覆盖「当前用户读不到」——服务端不区分不存在与无权限。 */
  publicationStatus: 'ACTIVE' | 'UNLISTED' | 'DELETED';
}

/** 单次最多 100 条；服务端沿收录链取根来源笔记的实时状态。 */
export const NOTE_SOURCE_STATES_MAX = 100;

export async function fetchNoteSourceStates(
  noteIds: readonly string[],
): Promise<NoteSourceState[]> {
  const unique = [...new Set(noteIds.filter((id) => id.length > 0))].slice(
    0,
    NOTE_SOURCE_STATES_MAX,
  );
  if (unique.length === 0) return [];
  return apiClient<NoteSourceState[]>('/note/source-states', {
    method: 'POST',
    body: { noteIds: unique },
  });
}

export async function setNoteSourceGroup(
  id: string,
  conversationID: string | null,
): Promise<{ id: string; sourceConversationID: string | null }> {
  return markNoteWrite(apiClient<{ id: string; sourceConversationID: string | null }>(
    `/note/${id}/source-group`,
    { method: 'PATCH', body: { conversationID } },
  ));
}

/** FE#92 回收站：已软删笔记列表。 */
export async function fetchDeletedNotes(): Promise<NoteSummary[]> {
  return apiClient<NoteSummary[]>('/note/recycle-bin');
}

/** FE#92 回收站：恢复软删笔记（后端恢复为 ACTIVE）。 */
/** 回收站「立即删除」：不等 30 天到期，直接永久删除（只接受已在回收站的笔记）。 */
export async function purgeNote(id: string): Promise<void> {
  await markNoteWrite(apiClient<void>(`/note/${id}/permanent`, { method: 'DELETE' }));
}

export async function restoreNote(id: string): Promise<void> {
  return markNoteWrite(apiClient<void>(`/note/${id}/restore`, { method: 'POST' }));
}

export async function deleteNote(id: string): Promise<void> {
  await markNoteWrite(apiClient<void>(`/note/${id}`, { method: 'DELETE' }));
}

export async function createNoteShareLink(
  input: CreateNoteShareLinkInput,
): Promise<NoteShareLink> {
  return markNoteWrite(apiClient<NoteShareLink>('/note/share-links', {
    method: 'POST',
    body: input,
  }));
}

export async function createNoteExport(
  noteId: string,
  input: CreateNoteExportInput,
): Promise<NoteExportResult> {
  return markNoteWrite(apiClient<NoteExportResult>(`/note/${noteId}/exports`, {
    method: 'POST',
    body: input,
  }));
}

export async function fetchNoteGroups(): Promise<NoteGroup[]> {
  return apiClient<NoteGroup[]>('/note/group');
}

export async function createNoteGroup(name: string): Promise<NoteGroup> {
  return markNoteWrite(apiClient<NoteGroup>('/note/group', { method: 'POST', body: { name } }));
}

export async function updateNoteGroup(id: string, name: string): Promise<NoteGroup> {
  return markNoteWrite(apiClient<NoteGroup>(`/note/group/${id}`, { method: 'PATCH', body: { name } }));
}

export async function deleteNoteGroup(id: string): Promise<void> {
  await markNoteWrite(apiClient<void>(`/note/group/${id}`, { method: 'DELETE' }));
}

export async function reorderNoteGroups(groupIds: string[]): Promise<NoteGroup[]> {
  return markNoteWrite(apiClient<NoteGroup[]>('/note/group/order', {
    method: 'PATCH',
    body: { groupIds },
  }));
}
