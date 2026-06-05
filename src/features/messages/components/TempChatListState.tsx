import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface TempChatListStateProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const s = StyleSheet.create({
  block: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  retryButton: {
    minWidth: 96,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
});

export default function TempChatListState({
  loading,
  error,
  onRetry,
}: TempChatListStateProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const d = useMemo(
    () => ({
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      retryButton: { backgroundColor: colors.primary },
      retryButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  if (loading) {
    return (
      <View style={s.block}>
        <ActivityIndicator color={colors.primary} />
        <Text style={d.stateText}>{t('tempChats.loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.block}>
        <Text style={d.stateText}>{error}</Text>
        <Pressable style={[s.retryButton, d.retryButton]} onPress={onRetry}>
          <Text style={d.retryButtonText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.block}>
      <Text style={d.stateText}>{t('tempChats.empty')}</Text>
    </View>
  );
}
