import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, Typography, useTheme } from '@/theme';
import { PlazaPostCard } from '@/features/discover/components/plaza-post-card';
import { fetchPlazaPost } from '@/services/api/plaza';
import { ApiError } from '@/services/api/client';
import { getApiErrorMessage } from '@/services/api/errors';
import type { CirclePlazaPost } from '@/types';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
});

export default function PlazaPostDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [post, setPost] = useState<CirclePlazaPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    let cancelled = false;
    fetchPlazaPost(id)
      .then((data) => {
        if (!cancelled) setPost(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setPost(null);
        // 已删除/已结束/无权限 → 与 M2M 可见性一致，统一提示「帖子不存在」。
        setError(
          err instanceof ApiError && err.status === 404
            ? t('plaza.postDetail.notExist', { defaultValue: '帖子不存在或已结束' })
            : getApiErrorMessage(err, t('plaza.postDetail.loadFailed', {
                defaultValue: '加载失败，请稍后重试',
              })),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  return (
    <View style={[s.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <NavHeader title={t('plaza.postDetail.title', { defaultValue: '活动详情' })} />
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : post ? (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <PlazaPostCard post={post} />
        </ScrollView>
      ) : (
        <View style={s.center}>
          <Text style={[Typography.body, { color: colors.textSecondary }]}>
            {error ?? t('plaza.postDetail.notExist', { defaultValue: '帖子不存在或已结束' })}
          </Text>
        </View>
      )}
    </View>
  );
}
