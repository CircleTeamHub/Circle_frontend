import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { NoteRatingReasonSheet } from '@/features/notes/components/NoteRatingReasonSheet';
import { describeRatingBlock, ratingButtonBlock } from '@/features/notes/utils/note-rating';
import { reportHandledFailure } from '@/observability/report-failure';
import { ApiError } from '@/services/api/api-error';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  fetchNoteRatingSummary,
  rateNote,
  type NoteRatingReason,
  type NoteRatingSummary,
  type NoteRatingValue,
} from '@/services/api/note-ratings';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface NoteRatingBarProps {
  /** The note on screen: the owner's note, a collected copy, or one opened from a chat card. */
  noteId: string;
  /** Changes when eligibility may have changed on this screen (e.g. the note was just added). */
  refreshKey?: string;
  /** Owner only: opens the 查看差评 list of the source note. */
  onOpenBadRatings: (sourceNoteId: string) => void;
}

/**
 * "本月 · 👍 好评 N · 👎 差评 M". Counters reset monthly on the server. Greyed-out
 * buttons stay tappable and explain why the viewer cannot rate. Notes without
 * group cards cannot be rated and show nothing.
 */
export function NoteRatingBar({ noteId, refreshKey, onOpenBadRatings }: NoteRatingBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [summary, setSummary] = useState<NoteRatingSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reasonSheetVisible, setReasonSheetVisible] = useState(false);
  // State updates land a frame later; the ref stops a double tap from rating twice.
  const submittingRef = useRef(false);
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    fetchNoteRatingSummary(noteId)
      .then((next) => {
        if (request === requestRef.current) setSummary(next);
      })
      .catch((error: unknown) => {
        if (request !== requestRef.current) return;
        setSummary(null);
        reportHandledFailure('noteRating', 'loadSummary', error);
      });
  }, [noteId]);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [load, refreshKey]);

  const explain = useCallback(
    (reason: string) => {
      Alert.alert(
        t('notes.rating.blockedTitle', { defaultValue: '暂时不能评分' }),
        describeRatingBlock(t, reason, summary?.nextRatableAt ?? null),
      );
    },
    [summary?.nextRatableAt, t],
  );

  const submit = useCallback(
    async (input: { value: 'GOOD' } | { value: 'BAD'; reason: NoteRatingReason; comment?: string }) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      // A summary still in flight was read before this rating: drop it.
      requestRef.current += 1;
      try {
        const result = await rateNote(noteId, input);
        setReasonSheetVisible(false);
        setSummary((current) =>
          current
            ? {
                ...current,
                goodCount: result.goodCount,
                badCount: result.badCount,
                canRate: false,
                reason: 'NOTE_RATING_RATER_DAILY_LIMIT',
                nextRatableAt: result.nextRatableAt,
              }
            : current,
        );
        if (result.status === 'HELD') {
          Alert.alert(t('notes.rating.heldNotice', { defaultValue: '评分已提交，正在审核，通过后计入本月计数。' }));
        }
      } catch (error) {
        reportHandledFailure('noteRating', 'rate', error);
        setReasonSheetVisible(false);
        Alert.alert(
          t('notes.rating.failedTitle', { defaultValue: '评分失败' }),
          getApiErrorMessage(error, t('common.retryLater', { defaultValue: '请稍后重试' })),
        );
        // A rejected rating means our eligibility view was stale.
        if (error instanceof ApiError && error.errorCode?.startsWith('NOTE_RATING_')) load();
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [load, noteId, t],
  );

  const d = useMemo(
    () => ({
      bar: { backgroundColor: colors.surfaceMuted },
      text: { color: colors.text },
      muted: { color: colors.textSecondary },
      button: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
    }),
    [colors],
  );

  if (!summary || summary.reason === 'NOTE_RATING_NO_GROUP') return null;
  const isOwner = summary.reason === 'NOTE_RATING_OWNER';
  // The page outlived the wait (cooldown or day ended): ask the server again.
  const waitIsOver = summary.nextRatableAt !== null && Date.parse(summary.nextRatableAt) <= Date.now();

  const renderButton = (value: NoteRatingValue) => {
    const good = value === 'GOOD';
    const count = good ? summary.goodCount : summary.badCount;
    const label = good
      ? t('notes.rating.good', { defaultValue: '好评 {{count}}', count })
      : t('notes.rating.bad', { defaultValue: '差评 {{count}}', count });
    const content = (
      <Text style={[s.buttonText, d.text]} numberOfLines={1}>
        {good ? '👍' : '👎'} {label}
      </Text>
    );
    if (isOwner) {
      return (
        <View key={value} style={[s.button, d.button]} testID={`note-rating-count-${value}`}>
          {content}
        </View>
      );
    }
    const blocked = ratingButtonBlock(summary, value);
    return (
      <Pressable
        key={value}
        testID={`note-rating-${value}`}
        style={({ pressed }) => [
          s.button,
          d.button,
          blocked ? s.blocked : null,
          pressed && !blocked ? s.pressed : null,
        ]}
        disabled={submitting}
        onPress={() => {
          if (blocked && waitIsOver) load();
          else if (blocked) explain(blocked);
          else if (good) void submit({ value: 'GOOD' });
          else setReasonSheetVisible(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${good
          ? t('notes.rating.rateGood', { defaultValue: '给好评' })
          : t('notes.rating.rateBad', { defaultValue: '给差评' })} · ${label}`}
        // Greyed out but still actionable: the tap explains the reason, so screen
        // readers must not announce it as disabled.
        accessibilityHint={blocked ? describeRatingBlock(t, blocked, summary.nextRatableAt) : undefined}
        accessibilityState={{ busy: submitting }}
      >
        {content}
      </Pressable>
    );
  };

  return (
    <View style={[s.bar, d.bar]} testID="note-rating-bar">
      <View style={s.row}>
        <Text style={[s.month, d.muted]}>
          {t('notes.rating.monthLabel', { defaultValue: '本月' })}
        </Text>
        {renderButton('GOOD')}
        {renderButton('BAD')}
      </View>
      {isOwner ? (
        <Pressable
          testID="note-rating-view-bad"
          style={s.link}
          onPress={() => onOpenBadRatings(summary.noteId)}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[s.linkText, { color: colors.primary }]}>
            {t('notes.rating.viewBad', { defaultValue: '查看差评' })}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </Pressable>
      ) : null}
      <NoteRatingReasonSheet
        visible={reasonSheetVisible}
        submitting={submitting}
        onClose={() => setReasonSheetVisible(false)}
        onSubmit={(reason, comment) =>
          void submit({ value: 'BAD', reason, ...(comment ? { comment } : {}) })
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    marginTop: Spacing.lg,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  month: { ...Typography.small, fontWeight: '600' },
  button: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  buttonText: { ...Typography.caption, fontVariant: ['tabular-nums'] },
  blocked: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  link: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 2, minHeight: 32 },
  linkText: { ...Typography.caption },
});
