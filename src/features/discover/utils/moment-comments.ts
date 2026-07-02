import type { MomentComment } from '@/types';

export interface MomentCommentThread {
  comment: MomentComment;
  replies: MomentComment[];
}

export interface MomentCommentRow {
  id: string;
  comment: MomentComment;
  isReply: boolean;
}

export interface MomentCommentPreviewState {
  visibleThreads: MomentCommentThread[];
  hiddenCount: number;
}

export interface LikedFriendsPreview {
  namesText: string;
  hiddenCount: number;
  separator: string;
}

export const DEFAULT_MOMENT_COMMENT_PREVIEW_LIMIT = 4;
export const DEFAULT_LIKED_FRIENDS_PREVIEW_LIMIT = 3;

interface IndexedComment {
  comment: MomentComment;
  index: number;
}

function getTime(comment: MomentComment) {
  const time = Date.parse(comment.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

function sortIndexedComments(comments: MomentComment[]) {
  return comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => {
      const timeDiff = getTime(a.comment) - getTime(b.comment);
      return timeDiff === 0 ? a.index - b.index : timeDiff;
    });
}

function findThreadRootId(
  comment: MomentComment,
  commentsById: Map<string, MomentComment>,
) {
  if (!comment.replyTo) {
    return comment.id;
  }

  let parent = commentsById.get(comment.replyTo.id);
  if (!parent) {
    return comment.id;
  }

  const seen = new Set<string>([comment.id]);
  while (parent.replyTo) {
    if (seen.has(parent.id)) {
      return comment.id;
    }
    seen.add(parent.id);

    const next = commentsById.get(parent.replyTo.id);
    if (!next) {
      return parent.id;
    }
    parent = next;
  }

  return parent.id;
}

export function buildMomentCommentThreads(
  comments: MomentComment[],
): MomentCommentThread[] {
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const sorted = sortIndexedComments(comments);
  const repliesByRootId = new Map<string, IndexedComment[]>();
  const rootIds = new Set<string>();

  for (const indexed of sorted) {
    const rootId = findThreadRootId(indexed.comment, commentsById);
    if (rootId === indexed.comment.id) {
      rootIds.add(rootId);
      continue;
    }

    rootIds.add(rootId);
    const replies = repliesByRootId.get(rootId) ?? [];
    replies.push(indexed);
    repliesByRootId.set(rootId, replies);
  }

  return sorted
    .filter(({ comment }) => rootIds.has(comment.id))
    .map(({ comment }) => ({
      comment,
      replies: (repliesByRootId.get(comment.id) ?? []).map(
        (reply) => reply.comment,
      ),
    }));
}

export function countMomentCommentRows(threads: MomentCommentThread[]) {
  return threads.reduce(
    (total, thread) => total + 1 + thread.replies.length,
    0,
  );
}

export function getPreviewMomentCommentThreads(
  threads: MomentCommentThread[],
  limit = DEFAULT_MOMENT_COMMENT_PREVIEW_LIMIT,
): MomentCommentThread[] {
  if (countMomentCommentRows(threads) <= limit) {
    return threads;
  }

  const visible: MomentCommentThread[] = [];
  let remaining = limit;

  for (const thread of threads) {
    if (remaining <= 0) {
      break;
    }

    const replies = thread.replies.slice(0, Math.max(0, remaining - 1));
    visible.push({ comment: thread.comment, replies });
    remaining -= 1 + replies.length;
  }

  return visible;
}

export function getMomentCommentPreviewState(
  threads: MomentCommentThread[],
  totalCommentCount: number,
  limit = DEFAULT_MOMENT_COMMENT_PREVIEW_LIMIT,
): MomentCommentPreviewState {
  const visibleThreads = getPreviewMomentCommentThreads(threads, limit);
  const visibleRows = countMomentCommentRows(visibleThreads);
  const loadedRows = countMomentCommentRows(threads);
  const totalRows = Math.max(totalCommentCount, loadedRows);

  return {
    visibleThreads,
    hiddenCount: Math.max(0, totalRows - visibleRows),
  };
}

export function flattenMomentCommentThreads(
  threads: MomentCommentThread[],
): MomentCommentRow[] {
  return threads.flatMap((thread) => [
    { id: thread.comment.id, comment: thread.comment, isReply: false },
    ...thread.replies.map((reply) => ({
      id: reply.id,
      comment: reply,
      isReply: true,
    })),
  ]);
}

export function buildLikedFriendsPreview(
  likedFriends: { id: string; nickname: string }[],
  language: string | undefined,
  limit = DEFAULT_LIKED_FRIENDS_PREVIEW_LIMIT,
): LikedFriendsPreview {
  const normalizedLanguage = language?.toLowerCase() ?? '';
  // 中文、日文列举用顿号「、」；其余语言用逗号。
  const usesIdeographicComma =
    normalizedLanguage.startsWith('zh') || normalizedLanguage.startsWith('ja');
  const separator = usesIdeographicComma ? '、' : ', ';
  const visibleFriends = likedFriends.slice(0, limit);

  return {
    namesText: visibleFriends.map((friend) => friend.nickname).join(separator),
    hiddenCount: Math.max(0, likedFriends.length - visibleFriends.length),
    separator,
  };
}
