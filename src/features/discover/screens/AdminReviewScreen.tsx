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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { id: circleId } = useLocalSearchParams<{ id: string }>();
  const [invitations, setInvitations] = useState<CircleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!circleId) return;
    setLoadError(null);
    try {
      const data = await fetchPendingInvitationsForCircle(circleId);
      setInvitations(data);
    } catch (error) {
      setLoadError(
        t('invitation.loadFailed', { defaultValue: '加载失败，请稍后重试' }),
      );
      if (__DEV__) {
        console.warn('[AdminReviewScreen] fetchPendingInvitationsForCircle failed', error);
      }
    } finally {
      setLoading(false);
    }
  }, [circleId, t]);

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
      retryButton: {
        marginTop: Spacing.md,
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

  const handleOverride = useCallback(
    (inv: CircleInvitation) => {
      Alert.alert(
        t('invitation.confirmOverride'),
        t('invitation.overrideMessage', { name: inv.applicant.nickname }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            style: 'destructive',
            onPress: async () => {
              setApprovingId(inv.id);
              try {
                await adminApproveInvitation(inv.id);
                setInvitations((prev) =>
                  prev.filter((i) => i.id !== inv.id),
                );
                Alert.alert(t('invitation.overrideApproved'), t('invitation.joinedCircle', { name: inv.applicant.nickname }));
              } catch (error: unknown) {
                const message =
                  error instanceof Error ? error.message : t('common.errorOccurred');
                Alert.alert(t('common.errorOccurred'), message);
              } finally {
                setApprovingId(null);
              }
            },
          },
        ],
      );
    },
    [t],
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
              <Text style={d.overrideText}>{t('invitation.override')}</Text>
            )}
          </Pressable>
        </View>
        <Divider />
      </View>
    ),
    [handleOverride, d, approvingId, colors, t],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('invitation.adminReview')} />
      {loading ? (
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError && invitations.length === 0 ? (
        <View style={s.centerLoader}>
          <Text style={d.emptyText}>{loadError}</Text>
          <Pressable style={d.retryButton} onPress={loadData}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={invitations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <View style={s.centerLoader}>
              <Text style={d.emptyText}>{t('invitation.noPendingReviews')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
