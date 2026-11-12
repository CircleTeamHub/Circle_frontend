import type { TFunction } from 'i18next';
import type { NoteRatingSummary, NoteRatingValue } from '@/services/api/note-ratings';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const BLOCK_MESSAGE_KEYS: Record<string, string> = {
  // No extra context to add to these: the server error copy says it all.
  NOTE_RATING_OWNER: 'serverErrors.NOTE_RATING_OWNER',
  NOTE_RATING_NO_GROUP: 'serverErrors.NOTE_RATING_NO_GROUP',
  NOTE_RATING_COOLDOWN: 'serverErrors.NOTE_RATING_COOLDOWN',
  NOTE_RATING_NOT_COLLECTED: 'notes.rating.blocked.NOTE_RATING_NOT_COLLECTED',
  NOTE_RATING_NOT_IN_GROUP: 'notes.rating.blocked.NOTE_RATING_NOT_IN_GROUP',
  NOTE_RATING_LOW_CREDIT: 'notes.rating.blocked.NOTE_RATING_LOW_CREDIT',
  NOTE_RATING_ACCOUNT_TOO_NEW: 'notes.rating.blocked.NOTE_RATING_ACCOUNT_TOO_NEW',
  NOTE_RATING_RATER_DAILY_LIMIT: 'notes.rating.blocked.NOTE_RATING_RATER_DAILY_LIMIT',
  NOTE_RATING_NOTE_GOOD_FULL: 'notes.rating.blocked.NOTE_RATING_NOTE_GOOD_FULL',
  NOTE_RATING_NOTE_BAD_FULL: 'notes.rating.blocked.NOTE_RATING_NOTE_BAD_FULL',
};

/** Codes whose message depends on nextRatableAt (the 72h per-note cooldown). */
const TIMED_BLOCKS = new Set(['NOTE_RATING_COOLDOWN', 'NOTE_RATING_RATER_DAILY_LIMIT']);

/** The NOTE_RATING_* code that greys this button out, or null when it can be pressed. */
export function ratingButtonBlock(
  summary: Pick<NoteRatingSummary, 'reason' | 'goodFull' | 'badFull'>,
  value: NoteRatingValue,
): string | null {
  if (summary.reason) return summary.reason;
  if (value === 'GOOD' && summary.goodFull) return 'NOTE_RATING_NOTE_GOOD_FULL';
  if (value === 'BAD' && summary.badFull) return 'NOTE_RATING_NOTE_BAD_FULL';
  return null;
}

/**
 * Why the viewer cannot rate, in words. When this note's cooldown outlasts
 * today (rated it within 72h), the wait for this note is what matters, so it
 * wins over "already rated today".
 */
export function describeRatingBlock(
  t: TFunction,
  reason: string,
  nextRatableAt: string | null,
  now = Date.now(),
): string {
  const left = nextRatableAt ? Date.parse(nextRatableAt) - now : 0;
  if (TIMED_BLOCKS.has(reason) && left > DAY_MS) {
    return t('notes.rating.blocked.cooldownDays', {
      defaultValue: '{{count}} 天后可再评这条笔记。',
      count: Math.ceil(left / DAY_MS),
    });
  }
  if (reason === 'NOTE_RATING_COOLDOWN' && left > 0) {
    return t('notes.rating.blocked.cooldownHours', {
      defaultValue: '{{count}} 小时后可再评这条笔记。',
      count: Math.ceil(left / HOUR_MS),
    });
  }
  const key = BLOCK_MESSAGE_KEYS[reason];
  return key
    ? t(key)
    : t('notes.rating.blocked.unknown', { defaultValue: '暂时不能评分，请稍后再试。' });
}
