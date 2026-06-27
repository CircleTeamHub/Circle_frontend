import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchMyPendingVerifications } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import type { CircleInvitation } from '@/types';

const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: {
    flex: 1,
  },
  progress: {
    ...Typography.caption,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: Spacing.md,
  },
});

export default function PendingVerificationsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<CircleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // mountedRef + requestRef 双重护栏：屏失焦/卸载或被新一轮 load 抢占时，
  // 不再对已过期的请求 setState（避免卸载后告警与旧数据覆盖新数据）。
  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyPendingVerifications();
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setItems(data);
    } catch (e) {
      if (!mountedRef.current || requestId !== requestRef.current) return;
      setError(getApiErrorMessage(e, '加载失败，请稍后重试'));
    } finally {
      if (mountedRef.current && requestId === requestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleRefreshVerifications = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await load();
    } finally {
      refreshInFlightRef.current = false;
      setRefreshing(false);
    }
  }, [load]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      name: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      desc: { color: colors.textSecondary, ...Typography.caption },
      progress: { color: colors.primary },
      emptyText: { color: colors.textSecondary, ...Typography.body },
      retryButton: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        backgroundColor: colors.primary,
      },
      retryText: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const renderItem = useCallback(
    ({ item }: { item: CircleInvitation }) => (
      <View>
        <Pressable
          style={s.row}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/discover/verification/[id]',
              params: { id: item.id },
            })
          }
        >
          <Avatar
            size={44}
            name={item.applicant.nickname}
            uri={item.applicant.avatarUrl ?? undefined}
          />
          <View style={s.info}>
            <Text style={d.name} numberOfLines={1}>
              {item.applicant.nickname}
            </Text>
            <Text style={d.desc} numberOfLines={1}>
              {t('invitation.wantsToJoin', {
                circle: item.circleName,
                defaultValue: `申请加入「${item.circleName}」`,
              })}
            </Text>
          </View>
          <Text style={[s.progress, d.progress]}>
            {item.approvedCount}/{item.requiredCount}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
        <Divider />
      </View>
    ),
    [router, colors, t, d],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('invitation.pendingTitle', { defaultValue: '待我验证' })}
      />
      {loading && items.length === 0 ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error && items.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{error}</Text>
          <Pressable style={d.retryButton} onPress={load}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          refreshing={refreshing}
          onRefresh={handleRefreshVerifications}
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Text style={d.emptyText}>
                {t('invitation.noPending', {
                  defaultValue: '暂无待你验证的入圈申请',
                })}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
