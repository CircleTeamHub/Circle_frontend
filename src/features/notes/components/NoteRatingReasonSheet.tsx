import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import {
  NOTE_RATING_COMMENT_MAX,
  NOTE_RATING_REASONS,
  type NoteRatingReason,
} from '@/services/api/note-ratings';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const REASON_KEYS: Record<NoteRatingReason, { key: string; fallback: string }> = {
  INACCURATE: { key: 'notes.rating.reasons.INACCURATE', fallback: '信息不实' },
  EXPIRED: { key: 'notes.rating.reasons.EXPIRED', fallback: '已失效' },
  BAD_EXPERIENCE: { key: 'notes.rating.reasons.BAD_EXPERIENCE', fallback: '体验差' },
  OTHER: { key: 'notes.rating.reasons.OTHER', fallback: '其他' },
};

export function noteRatingReasonLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  reason: NoteRatingReason,
): string {
  const entry = REASON_KEYS[reason] ?? REASON_KEYS.OTHER;
  return t(entry.key, { defaultValue: entry.fallback });
}

interface NoteRatingReasonSheetProps {
  visible: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reason: NoteRatingReason, comment?: string) => void;
}

/** 差评 needs a reason; 其他 also needs text (≤ 200 chars, like the backend). */
export function NoteRatingReasonSheet({ visible, submitting, onClose, onSubmit }: NoteRatingReasonSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [reason, setReason] = useState<NoteRatingReason | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setComment('');
  }, [visible]);

  const trimmed = comment.trim();
  const ready = reason !== null && (reason !== 'OTHER' || trimmed.length > 0) && !submitting;

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      text: { color: colors.text },
      option: { borderColor: colors.surfaceBorder },
      optionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
      input: { color: colors.text, borderColor: colors.surfaceBorder, backgroundColor: colors.background },
      submit: { backgroundColor: colors.primary },
    }),
    [colors],
  );

  return (
    <BottomSheetModal visible={visible} onClose={onClose} backdropStyle={d.backdrop} sheetStyle={s.sheetWrap}>
      <View style={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}>
        <View style={[s.handle, d.handle]} />
        <Text style={[s.title, d.text]}>
          {t('notes.rating.reasonSheet.title', { defaultValue: '差评原因' })}
        </Text>
        <View style={s.options}>
          {NOTE_RATING_REASONS.map((item) => {
            const selected = item === reason;
            return (
              <Pressable
                key={item}
                testID={`note-rating-reason-${item}`}
                style={[s.option, d.option, selected ? d.optionSelected : null]}
                onPress={() => setReason(item)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[s.optionText, d.text]}>{noteRatingReasonLabel(t, item)}</Text>
              </Pressable>
            );
          })}
        </View>
        {reason === 'OTHER' ? (
          <TextInput
            testID="note-rating-comment"
            style={[s.input, d.input]}
            value={comment}
            onChangeText={setComment}
            placeholder={t('notes.rating.reasonSheet.otherPlaceholder', {
              defaultValue: '说说具体情况（必填）',
            })}
            placeholderTextColor={colors.textSecondary}
            maxLength={NOTE_RATING_COMMENT_MAX}
            multiline
          />
        ) : null}
        <Pressable
          testID="note-rating-reason-submit"
          style={[s.submit, d.submit, ready ? null : s.submitDisabled]}
          disabled={!ready}
          onPress={() => {
            if (!reason) return;
            onSubmit(reason, reason === 'OTHER' ? trimmed : undefined);
          }}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color={colors.white} /> : null}
          <Text style={[s.submitText, { color: colors.white }]}>
            {submitting
              ? t('notes.rating.reasonSheet.submitting', { defaultValue: '提交中...' })
              : t('notes.rating.reasonSheet.submit', { defaultValue: '提交差评' })}
          </Text>
        </Pressable>
      </View>
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
  sheetWrap: { width: '100%' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.full, marginBottom: Spacing.xs },
  title: { ...Typography.h3, fontWeight: '700' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  option: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    justifyContent: 'center',
  },
  optionText: { ...Typography.body },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    textAlignVertical: 'top',
    ...Typography.bodyRegular,
  },
  submit: {
    height: 44,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { ...Typography.body, fontWeight: '600' },
});
