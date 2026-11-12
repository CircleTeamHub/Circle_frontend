import { Alert } from 'react-native';
import { create } from 'zustand';
import i18n from '@/i18n';
import { showTopNotice } from '@/components/app/top-notice-store';
import { describeRatingBlock, ratingButtonBlock } from '@/features/notes/utils/note-rating';
import { reportHandledFailure } from '@/observability/report-failure';
import { ApiError } from '@/services/api/api-error';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  fetchNoteRatingSummary,
  rateNote,
  type NoteRatingReason,
  type NoteRatingResult,
} from '@/services/api/note-ratings';

/**
 * 好评 / 差评 from a menu: the chat note card's long-press menu and the ⋯ sheet
 * in 我的笔记. Both close their own sheet first, so the reason sheet and the
 * result notice live in NoteRatingFlowHost at the app root.
 *
 * The note id is whatever the caller has (a chat card's note or a collected
 * copy); the server rates the source note and answers with its counters.
 */
export type NoteRatedListener = (result: NoteRatingResult) => void;

interface NoteRatingFlowState {
  /** Non-null while the 差评 reason sheet is open for this note. */
  badRequest: { noteId: string; onRated?: NoteRatedListener } | null;
}

export const useNoteRatingFlowStore = create<NoteRatingFlowState>(() => ({
  badRequest: null,
}));

/**
 * The menu that started the flow is a modal that is still animating out when
 * the user taps. iOS will not present another modal (the reason sheet) or an
 * alert over one that is being dismissed, so nothing is shown before this.
 */
export const MENU_HANDOFF_MS = 400;

const handoff = () => new Promise<void>((done) => setTimeout(done, MENU_HANDOFF_MS));

let inFlight = false;

function explainRejection(error: unknown): void {
  const t = i18n.t.bind(i18n);
  if (error instanceof ApiError && error.errorCode?.startsWith('NOTE_RATING_')) {
    const details = error.data as { nextRatableAt?: unknown } | undefined;
    const nextRatableAt =
      typeof details?.nextRatableAt === 'string' ? details.nextRatableAt : null;
    Alert.alert(
      t('notes.rating.blockedTitle', { defaultValue: '暂时不能评分' }),
      describeRatingBlock(t, error.errorCode, nextRatableAt),
    );
    return;
  }
  Alert.alert(
    t('notes.rating.failedTitle', { defaultValue: '评分失败' }),
    getApiErrorMessage(error, t('common.retryLater', { defaultValue: '请稍后重试' })),
  );
}

function announce(result: NoteRatingResult): void {
  const t = i18n.t.bind(i18n);
  if (result.status === 'HELD') {
    showTopNotice({
      type: 'info',
      title: t('notes.rating.heldNotice', { defaultValue: '评分已提交，正在审核，通过后计入本月计数。' }),
    });
    return;
  }
  showTopNotice({
    type: 'success',
    title: t('notes.rating.ratedTitle', { defaultValue: '已评分' }),
    message: t('notes.rating.countsA11y', {
      defaultValue: '本月好评 {{good}}，差评 {{bad}}',
      good: result.goodCount,
      bad: result.badCount,
    }),
  });
}

async function submit(
  noteId: string,
  input: { value: 'GOOD' } | { value: 'BAD'; reason: NoteRatingReason; comment?: string },
  onRated: NoteRatedListener | undefined,
): Promise<void> {
  // Started from a menu or the reason sheet: both are modals still closing.
  const closing = handoff();
  try {
    const result = await rateNote(noteId, input);
    onRated?.(result);
    await closing;
    announce(result);
  } catch (error) {
    reportHandledFailure('noteRating', 'rate', error);
    await closing;
    explainRejection(error);
  }
}

/** 好评 rates at once; a rejection explains why (cooldown, not in the group, …). */
export async function rateNoteGood(noteId: string, onRated?: NoteRatedListener): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await submit(noteId, { value: 'GOOD' }, onRated);
  } finally {
    inFlight = false;
  }
}

/**
 * 差评 needs a reason, so check eligibility before asking for one: a rater who
 * cannot rate learns why straight away instead of after filling in the sheet.
 */
export async function startBadNoteRating(noteId: string, onRated?: NoteRatedListener): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const [summary] = await Promise.all([fetchNoteRatingSummary(noteId), handoff()]);
    const blocked = ratingButtonBlock(summary, 'BAD');
    if (blocked) {
      const t = i18n.t.bind(i18n);
      Alert.alert(
        t('notes.rating.blockedTitle', { defaultValue: '暂时不能评分' }),
        describeRatingBlock(t, blocked, summary.nextRatableAt),
      );
      return;
    }
    useNoteRatingFlowStore.setState({ badRequest: { noteId, onRated } });
  } catch (error) {
    reportHandledFailure('noteRating', 'checkBadRating', error);
    explainRejection(error);
  } finally {
    inFlight = false;
  }
}

/** Called by the reason sheet in NoteRatingFlowHost. */
export async function submitBadNoteRating(reason: NoteRatingReason, comment?: string): Promise<void> {
  const { badRequest } = useNoteRatingFlowStore.getState();
  if (!badRequest || inFlight) return;
  inFlight = true;
  // Close first: the sheet is a modal too, and the result alert must not race it.
  useNoteRatingFlowStore.setState({ badRequest: null });
  try {
    await submit(
      badRequest.noteId,
      { value: 'BAD', reason, ...(comment ? { comment } : {}) },
      badRequest.onRated,
    );
  } finally {
    inFlight = false;
  }
}

export function cancelBadNoteRating(): void {
  useNoteRatingFlowStore.setState({ badRequest: null });
}
