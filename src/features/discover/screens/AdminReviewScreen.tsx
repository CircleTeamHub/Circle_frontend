import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  adminApproveInvitation,
  fetchPendingInvitationsForCircle,
} from '@/services/api/circles';
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
  progressBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    marginRight: Spacing.sm,
  },
  overrideBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 16,
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function AdminReviewScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { id: circleId } = useLocalSearchParams<{ id: string }>();
  const [invitations, setInvitations] = useState<CircleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!circleId) return;
    try {
      const data = await fetchPendingInvitationsForCircle(circleId);
      setInvitations(data);
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      name: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      progress: { color: colors.primary, ...Typography.caption },
      progressBadge: { backgroundColor: colors.primaryLight },
      overrideBtn: { backgroundColor: colors.warning },
      overrideText: { color: colors.white, ...Typography.caption, fontWeight: '600' as const },
      emptyText: { color: colors.textSecondary, ...Typography.body },
    }),
    [colors],
  );

  const handleOverride = useCallback(
    (inv: CircleInvitation) => {
      Alert.alert(
        '确认开后门？',
        `确定让 ${inv.applicant.nickname} 跳过验证直接加入圈子吗？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '确认',
            style: 'destructive',
            onPress: async () => {
              setApprovingId(inv.id);
              try {
                await adminApproveInvitation(inv.id);
                setInvitations((prev) =>
                  prev.filter((i) => i.id !== inv.id),
                );
                Alert.alert('已通过', `${inv.applicant.nickname} 已加入圈子`);
              } catch (error: unknown) {
                const message =
                  error instanceof Error ? error.message : '操作失败';
                Alert.alert('操作失败', message);
              } finally {
                setApprovingId(null);
              }
            },
          },
        ],
      );
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: CircleInvitation }) => (
      <View>
        <View style={s.row}>
          <Avatar
            size={44}
            name={item.applicant.nickname}
            uri={item.applicant.avatarUrl ?? undefined}
          />
          <View style={s.info}>
            <Text style={d.name}>{item.applicant.nickname}</Text>
          </View>
          <View style={[s.progressBadge, d.progressBadge]}>
            <Text style={d.progress}>
              {item.approvedCount}/{item.requiredCount}
            </Text>
          </View>
          <Pressable
            style={[s.overrideBtn, d.overrideBtn]}
            onPress={() => handleOverride(item)}
            disabled={approvingId === item.id}
          >
            {approvingId === item.id ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={d.overrideText}>开后门</Text>
            )}
          </Pressable>
        </View>
        <Divider />
      </View>
    ),
    [handleOverride, d, approvingId, colors],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="入圈审核" />
      {loading ? (
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={invitations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <View style={s.centerLoader}>
              <Text style={d.emptyText}>暂无待审核的申请</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
