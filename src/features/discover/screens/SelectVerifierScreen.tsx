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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { addVerifierToInvitation } from '@/services/api/circles';

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
  selectBtn: {
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

export default function SelectVerifierScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id: invitationId } = useLocalSearchParams<{
    id: string;
    circleId: string;
  }>();

  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchFriends();
      setFriends(data);
    } catch (error) {
      setLoadError(
        t('invitation.loadFriendsFailed', {
          defaultValue: '加载好友列表失败，请稍后重试',
        }),
      );
      if (__DEV__) {
        console.warn('[SelectVerifierScreen] fetchFriends failed', error);
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      name: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      accountId: { color: colors.textSecondary, ...Typography.caption },
      selectBtn: { backgroundColor: colors.primary },
      selectText: { color: colors.white, ...Typography.caption, fontWeight: '600' as const },
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

  const handleSelect = useCallback(
    async (friend: FriendProfile) => {
      if (!invitationId || submittingId) return;
      setSubmittingId(friend.id);
      try {
        await addVerifierToInvitation(invitationId, friend.id);
        Alert.alert(t('invitation.invited'), t('invitation.invitedMessage', { name: friend.nickname }));
        router.back();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : t('invitation.addFailed');
        Alert.alert(t('invitation.addFailed'), message);
      } finally {
        setSubmittingId(null);
      }
    },
    [invitationId, submittingId, router, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: FriendProfile }) => (
      <View>
        <View style={s.row}>
          <Avatar
            size={44}
            name={item.nickname}
            uri={item.avatarUrl ?? undefined}
          />
          <View style={s.info}>
            <Text style={d.name}>{item.nickname}</Text>
            <Text style={d.accountId}>{item.accountId}</Text>
          </View>
          <Pressable
            style={[s.selectBtn, d.selectBtn]}
            onPress={() => handleSelect(item)}
            disabled={submittingId === item.id}
          >
            {submittingId === item.id ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={d.selectText}>{t('invitation.select')}</Text>
            )}
          </Pressable>
        </View>
        <Divider />
      </View>
    ),
    [handleSelect, d, submittingId, colors, t],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('invitation.selectVerifier')} />
      {loading ? (
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError && friends.length === 0 ? (
        <View style={s.centerLoader}>
          <Text style={d.emptyText}>{loadError}</Text>
          <Pressable style={d.retryButton} onPress={loadFriends}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <View style={s.centerLoader}>
              <Text style={{ color: colors.textSecondary, ...Typography.body }}>
                {t('invitation.noFriends')}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
