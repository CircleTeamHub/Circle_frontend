import { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';

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
  | { kind: 'loading' }
  | { kind: 'error'; message: string; onRetry: () => void }
  | { kind: 'empty'; city: string | null; onNationwide: () => void };

/** 榜单没有条目时占据列表的那一块：加载中 / 失败可重试 / 空榜（城市榜给一键看全国榜）。 */
export const NoteRankingStatus = memo(function NoteRankingStatus(props: NoteRankingStatusProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      title: { color: colors.text },
      hint: { color: colors.textSecondary },
      errorCircle: { backgroundColor: colors.surfaceMuted },
      emptyCircle: { backgroundColor: withAlpha(colors.ratingGood, 0.12) },
      retry: { backgroundColor: colors.primary },
      retryText: { color: colors.white },
      nationwide: { backgroundColor: withAlpha(colors.ratingGood, 0.12) },
      nationwideText: { color: colors.ratingGood },
    }),
    [colors],
  );

  if (props.kind === 'loading') {
    return (
      <View style={s.block} testID="note-ranking-loading">
        <ActivityIndicator color={colors.ratingGood} />
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
  return (
    <View style={s.block}>
      <View style={[s.iconCircle, d.emptyCircle]}>
        <Ionicons name="trophy-outline" size={32} color={colors.ratingGood} />
      </View>
      <Text style={[s.title, d.title]}>
        {city
          ? t('explore.ranking.emptyCity', { defaultValue: '{{city}}这个月还没有上榜的笔记', city })
          : t('explore.ranking.empty', { defaultValue: '这个月还没有上榜的笔记' })}
      </Text>
      <Text style={[s.hint, d.hint]}>
        {city
          ? t('explore.ranking.emptyHint', { defaultValue: '在笔记标题里选上城市，收到好评就会上榜。' })
          : t('explore.ranking.emptyHintNationwide', { defaultValue: '笔记收到好评就会上榜。' })}
      </Text>
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
