import { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { NOTE_RATING_BAD_ICON } from '@/features/notes/components/NoteRatingCounts';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import type { NoteRankingBoard } from '@/features/notes/types';

const ICON_CIRCLE_SIZE = 72;
const BUTTON_HEIGHT = 40;

const s = StyleSheet.create({
  block: {
    alignItems: 'center',
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  iconCircle: {
    width: ICON_CIRCLE_SIZE,
    height: ICON_CIRCLE_SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.body, fontWeight: '600', textAlign: 'center' },
  hint: { ...Typography.bodyRegular, lineHeight: 20, textAlign: 'center' },
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  buttonText: { ...Typography.body, fontWeight: '700' },
});

type NoteRankingStatusProps =
  | { kind: 'loading'; board: NoteRankingBoard }
  | { kind: 'error'; message: string; onRetry: () => void }
  | { kind: 'empty'; board: NoteRankingBoard; city: string | null; onNationwide: () => void };

/**
 * 榜单没有条目时占据列表的那一块：加载中 / 失败可重试 / 空榜（城市榜给一键看全国榜）。
 * 转圈和空榜跟着榜单的颜色走：好评榜橙、差评榜蓝。
 */
export const NoteRankingStatus = memo(function NoteRankingStatus(props: NoteRankingStatusProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const bad = props.kind !== 'error' && props.board === 'bad';
  const accent = bad ? colors.ratingBad : colors.ratingGood;
  const d = useMemo(
    () => ({
      title: { color: colors.text },
      hint: { color: colors.textSecondary },
      errorCircle: { backgroundColor: colors.surfaceMuted },
      emptyCircle: { backgroundColor: withAlpha(accent, 0.12) },
      retry: { backgroundColor: colors.primary },
      retryText: { color: colors.white },
      nationwide: { backgroundColor: withAlpha(accent, 0.12) },
      nationwideText: { color: accent },
    }),
    [accent, colors],
  );

  if (props.kind === 'loading') {
    return (
      <View style={s.block} testID="note-ranking-loading">
        <ActivityIndicator color={accent} />
      </View>
    );
  }

  if (props.kind === 'error') {
    return (
      <View style={s.block}>
        <View style={[s.iconCircle, d.errorCircle]}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} />
        </View>
        <Text style={[s.hint, d.hint]}>{props.message}</Text>
        <Pressable
          style={[s.button, d.retry]}
          onPress={props.onRetry}
          accessibilityRole="button"
        >
          <Text style={[s.buttonText, d.retryText]}>{t('common.retry', { defaultValue: '重试' })}</Text>
        </Pressable>
      </View>
    );
  }

  const { city, onNationwide } = props;
  let title: string;
  let hint: string;
  if (bad) {
    title = city
      ? t('explore.ranking.emptyCityBad', { defaultValue: '{{city}}这个月还没有笔记上差评榜', city })
      : t('explore.ranking.emptyBad', { defaultValue: '这个月还没有笔记上差评榜' });
    hint = t('explore.ranking.emptyHintBad', { defaultValue: '收到差评的笔记会出现在这里。' });
  } else {
    title = city
      ? t('explore.ranking.emptyCity', { defaultValue: '{{city}}这个月还没有上榜的笔记', city })
      : t('explore.ranking.empty', { defaultValue: '这个月还没有上榜的笔记' });
    hint = city
      ? t('explore.ranking.emptyHint', { defaultValue: '在笔记标题里选上城市，收到好评就会上榜。' })
      : t('explore.ranking.emptyHintNationwide', { defaultValue: '笔记收到好评就会上榜。' });
  }
  return (
    <View style={s.block}>
      <View style={[s.iconCircle, d.emptyCircle]}>
        {bad ? (
          <MaterialCommunityIcons name={NOTE_RATING_BAD_ICON} size={32} color={accent} />
        ) : (
          <Ionicons name="trophy-outline" size={32} color={accent} />
        )}
      </View>
      <Text style={[s.title, d.title]}>{title}</Text>
      <Text style={[s.hint, d.hint]}>{hint}</Text>
      {city ? (
        <Pressable style={[s.button, d.nationwide]} onPress={onNationwide} accessibilityRole="button">
          <Text style={[s.buttonText, d.nationwideText]}>
            {t('explore.ranking.viewNationwide', { defaultValue: '看看全国榜' })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});
