import { apiClient } from '@/services/api/client';

/**
 * Note ratings (好评 / 差评). Ratings and counters always belong to the source
 * note (root of the collect chain); the server resolves a collected copy's id
 * to it, so callers pass whichever note id they have open.
 */
export type NoteRatingValue = 'GOOD' | 'BAD';
export type NoteRatingReason = 'INACCURATE' | 'EXPIRED' | 'BAD_EXPERIENCE' | 'OTHER';
export const NOTE_RATING_REASONS: readonly NoteRatingReason[] = [
  'INACCURATE',
  'EXPIRED',
  'BAD_EXPERIENCE',
  'OTHER',
];
/** Matches the backend's NOTE_RATING_COMMENT_MAX / NOTE_RATING_APPEAL_REASON_MAX. */
export const NOTE_RATING_COMMENT_MAX = 200;
export const NOTE_RATING_APPEAL_REASON_MAX = 500;

export interface NoteRatingCounts {
  goodCount: number;
  badCount: number;
}

export interface NoteRatingSummary extends NoteRatingCounts {
  /** Source note the counters belong to. */
  noteId: string;
  /** Asia/Shanghai month of the counters (YYYY-MM): they reset every month. */
  month: string;
  canRate: boolean;
  /** NOTE_RATING_* code explaining why the viewer cannot rate. */
  reason: string | null;
  nextRatableAt: string | null;
  goodFull: boolean;
  badFull: boolean;
}

export interface NoteRatingResult extends NoteRatingCounts {
  noteId: string;
  month: string;
  ratingId: string;
  /** HELD = paused for review; it is not in the counters yet. */
  status: 'COUNTED' | 'HELD';
  nextRatableAt: string;
}

export interface NoteRatingAppeal {
  status: 'PENDING' | 'UPHELD' | 'REVOKED';
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
}

/** A bad rating as the note owner sees it — the rater is never included. */
export interface NoteBadRating {
  id: string;
  reason: NoteRatingReason;
  comment: string | null;
  status: 'COUNTED' | 'HELD' | 'VOID';
  createdAt: string;
  appeal: NoteRatingAppeal | null;
  canAppeal: boolean;
}

export interface NoteBadRatingPage {
  items: NoteBadRating[];
  nextCursor: string | null;
  appealsRemaining: number;
}

export function fetchNoteRatingSummary(noteId: string): Promise<NoteRatingSummary> {
  return apiClient<NoteRatingSummary>(`/note/${encodeURIComponent(noteId)}/ratings/summary`);
}

export function rateNote(
  noteId: string,
  input: { value: 'GOOD' } | { value: 'BAD'; reason: NoteRatingReason; comment?: string },
): Promise<NoteRatingResult> {
  return apiClient<NoteRatingResult>(`/note/${encodeURIComponent(noteId)}/ratings`, {
    method: 'POST',
    body: input,
  });
}

export function fetchNoteBadRatings(
  noteId: string,
  cursor?: string | null,
): Promise<NoteBadRatingPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiClient<NoteBadRatingPage>(
    `/note/${encodeURIComponent(noteId)}/ratings/bad${query}`,
  );
}

export function appealNoteRating(ratingId: string, reason: string): Promise<NoteBadRating> {
  return apiClient<NoteBadRating>(`/note/ratings/${encodeURIComponent(ratingId)}/appeal`, {
    method: 'POST',
    body: { reason },
  });
}
