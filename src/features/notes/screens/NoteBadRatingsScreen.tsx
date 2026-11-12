import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { NOTE_RATING_BAD_ICON } from '@/features/notes/components/NoteRatingCounts';
import { noteRatingReasonLabel } from '@/features/notes/components/NoteRatingReasonSheet';
import { reportHandledFailure } from '@/observability/report-failure';
import { ApiError } from '@/services/api/api-error';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  appealNoteRating,
  fetchNoteBadRatings,
  NOTE_RATING_APPEAL_REASON_MAX,
  type NoteBadRating,
} from '@/services/api/note-ratings';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { getLocalizedDateTimeLocale } from '@/utils/locale';

const APPEAL_STATUS_KEYS = {
  PENDING: { key: 'notes.rating.badList.appealStatus.PENDING', fallback: '申诉处理中' },
  UPHELD: { key: 'notes.rating.badList.appealStatus.UPHELD', fallback: '申诉未通过，差评保留' },
  REVOKED: { key: 'notes.rating.badList.appealStatus.REVOKED', fallback: '申诉已通过，差评已撤销' },
} as const;

/** The owner's bad ratings of one source note: reason, text, time — never the rater. */
export default function NoteBadRatingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const noteId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [items, setItems] = useState<NoteBadRating[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [appealsRemaining, setAppealsRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [appealTarget, setAppealTarget] = useState<NoteBadRating | null>(null);
  const [appealText, setAppealText] = useState('');
  const [appealing, setAppealing] = useState(false);
  const appealingRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const page = await fetchNoteBadRatings(noteId);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setAppealsRemaining(page.appealsRemaining);
    } catch (error) {
      reportHandledFailure('noteRating', 'loadBadRatings', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!noteId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchNoteBadRatings(noteId, nextCursor);
      setItems((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((known) => known.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
      setAppealsRemaining(page.appealsRemaining);
    } catch (error) {
      reportHandledFailure('noteRating', 'loadMoreBadRatings', error);
      Alert.alert(t('notes.rating.badList.loadFailed', { defaultValue: '差评加载失败' }));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, noteId, t]);

  const submitAppeal = useCallback(async () => {
    const target = appealTarget;
    const reason = appealText.trim();
    if (!target || !reason || appealingRef.current) return;
    appealingRef.current = true;
    setAppealing(true);
    try {
      const updated = await appealNoteRating(target.id, reason);
      const remaining = Math.max(appealsRemaining - 1, 0);
      setAppealsRemaining(remaining);
      setItems((current) =>
        current.map((item) =>
          item.id === updated.id
            ? updated
            : { ...item, canAppeal: item.canAppeal && remaining > 0 },
        ),
      );
      setAppealTarget(null);
    } catch (error) {
      reportHandledFailure('noteRating', 'appeal', error);
      Alert.alert(
        t('notes.rating.badList.appealFailedTitle', { defaultValue: '申诉失败' }),
        getApiErrorMessage(error, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
      // Already appealed elsewhere, quota used up, or no longer counted: the
      // list is stale, and retrying would hit the same answer.
      if (error instanceof ApiError && error.errorCode?.startsWith('NOTE_RATING_')) {
        setAppealTarget(null);
        void loadFirstPage();
      }
    } finally {
      appealingRef.current = false;
      setAppealing(false);
    }
  }, [appealTarget, appealText, appealsRemaining, loadFirstPage, t]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      muted: { color: colors.textSecondary },
      card: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      sheet: { backgroundColor: colors.surface },
      backdrop: { backgroundColor: colors.overlay },
      input: { color: colors.text, borderColor: colors.surfaceBorder, backgroundColor: colors.background },
    }),
    [colors],
  );

  const locale = getLocalizedDateTimeLocale(i18n.language);
  const renderItem = useCallback(
    ({ item }: { item: NoteBadRating }) => {
      const statusLabel =
        item.status === 'HELD'
          ? t('notes.rating.badList.status.HELD', { defaultValue: '审核中' })
          : item.status === 'VOID'
            ? t('notes.rating.badList.status.VOID', { defaultValue: '已撤销' })
            : null;
      const appealStatus = item.appeal ? APPEAL_STATUS_KEYS[item.appeal.status] : null;
      return (
        <View style={[s.card, d.card]} testID={`note-bad-rating-${item.id}`}>
          <View style={s.cardHeader}>
            <View style={s.reasonRow}>
              <MaterialCommunityIcons name={NOTE_RATING_BAD_ICON} size={18} color={colors.text} />
              <Text style={[s.reason, d.title]}>{noteRatingReasonLabel(t, item.reason)}</Text>
            </View>
            {statusLabel ? <Text style={[s.status, d.muted]}>{statusLabel}</Text> : null}
          </View>
          {item.comment ? <Text style={[s.comment, d.title]}>{item.comment}</Text> : null}
          <Text style={[s.time, d.muted]}>
            {new Date(item.createdAt).toLocaleString(locale)}
          </Text>
          {appealStatus ? (
            <Text
              style={[s.appealStatus, { color: item.appeal?.status === 'REVOKED' ? colors.success : colors.textSecondary }]}
              testID={`note-bad-rating-appeal-${item.id}`}
            >
              {t(appealStatus.key, { defaultValue: appealStatus.fallback })}
            </Text>
          ) : null}
          {item.canAppeal ? (
            <Pressable
              testID={`note-bad-rating-appeal-button-${item.id}`}
              style={[s.appealButton, { borderColor: colors.primary }]}
              onPress={() => {
                setAppealText('');
                setAppealTarget(item);
              }}
              accessibilityRole="button"
            >
              <Text style={[s.appealButtonText, { color: colors.primary }]}>
                {t('notes.rating.badList.appeal', { defaultValue: '申诉' })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      );
    },
    [colors, d, locale, t],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
      </View>
      <Text style={[s.pageTitle, d.title]}>
        {t('notes.rating.badList.title', { defaultValue: '差评' })}
      </Text>
      <Text style={[s.hint, d.muted]}>
        {t('notes.rating.badList.subtitle', { defaultValue: '只显示原因和时间，不显示评价人' })}
      </Text>
      {!loading && !loadError ? (
        <Text style={[s.hint, d.muted]} testID="note-bad-ratings-quota">
          {t('notes.rating.badList.appealsRemaining', {
            defaultValue: '本月还可申诉 {{count}} 次',
            count: appealsRemaining,
          })}
        </Text>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingTop: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.sm }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={s.empty} color={colors.primary} />
          ) : loadError ? (
            <View style={s.emptyWrap}>
              <Text style={[s.emptyText, d.muted]}>
                {t('notes.rating.badList.loadFailed', { defaultValue: '差评加载失败' })}
              </Text>
              <Pressable
                style={[s.retry, { backgroundColor: colors.primary }]}
                onPress={() => void loadFirstPage()}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.white }}>{t('common.retry', { defaultValue: '重试' })}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[s.emptyText, d.muted]}>
              {t('notes.rating.badList.empty', { defaultValue: '暂无差评' })}
            </Text>
          )
        }
        ListFooterComponent={
          nextCursor ? (
            <Pressable style={s.more} onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button">
              {loadingMore ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={{ color: colors.primary }}>
                  {t('notes.rating.badList.loadMore', { defaultValue: '加载更多' })}
                </Text>
              )}
            </Pressable>
          ) : null
        }
      />

      <BottomSheetModal
        visible={appealTarget !== null}
        onClose={() => setAppealTarget(null)}
        backdropStyle={d.backdrop}
        sheetStyle={s.sheetWrap}
      >
        <View style={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}>
          <Text style={[s.sheetTitle, d.title]}>
            {t('notes.rating.badList.appealSheet.title', { defaultValue: '申诉这条差评' })}
          </Text>
          <Text style={[s.hint, d.muted]}>
            {t('notes.rating.badList.appealSheet.hint', { defaultValue: '申诉处理期间差评仍计入本月计数。' })}
          </Text>
          <TextInput
            testID="note-bad-rating-appeal-input"
            style={[s.input, d.input]}
            value={appealText}
            onChangeText={setAppealText}
            placeholder={t('notes.rating.badList.appealSheet.placeholder', { defaultValue: '说明理由（必填）' })}
            placeholderTextColor={colors.textSecondary}
            maxLength={NOTE_RATING_APPEAL_REASON_MAX}
            multiline
          />
          <Pressable
            testID="note-bad-rating-appeal-submit"
            style={[s.submit, { backgroundColor: colors.primary }, !appealText.trim() || appealing ? s.submitDisabled : null]}
            disabled={!appealText.trim() || appealing}
            onPress={() => void submitAppeal()}
            accessibilityRole="button"
            accessibilityState={{ disabled: !appealText.trim() || appealing, busy: appealing }}
          >
            <Text style={[s.submitText, { color: colors.white }]}>
              {appealing
                ? t('notes.rating.badList.appealSheet.submitting', { defaultValue: '提交中...' })
                : t('notes.rating.badList.appealSheet.submit', { defaultValue: '提交申诉' })}
            </Text>
          </Pressable>
        </View>
      </BottomSheetModal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  header: { height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  pageTitle: { ...Typography.h1, marginTop: Spacing.xs },
  hint: { ...Typography.small, marginTop: Spacing.xs },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1 },
  reason: { ...Typography.body, fontWeight: '600', flexShrink: 1 },
  status: { ...Typography.small, fontWeight: '600' },
  comment: { ...Typography.bodyRegular },
  time: { ...Typography.small },
  appealStatus: { ...Typography.small, fontWeight: '600' },
  appealButton: {
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  appealButtonText: { ...Typography.caption, fontWeight: '600' },
  empty: { paddingTop: Spacing.xl },
  emptyWrap: { alignItems: 'center', gap: Spacing.md },
  emptyText: { textAlign: 'center', paddingTop: Spacing.xl, ...Typography.bodyRegular },
  retry: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full },
  more: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  sheetWrap: { width: '100%' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  sheetTitle: { ...Typography.h3, fontWeight: '700' },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    textAlignVertical: 'top',
    ...Typography.bodyRegular,
  },
  submit: { height: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xs },
  submitDisabled: { opacity: 0.5 },
  submitText: { ...Typography.body, fontWeight: '600' },
});
