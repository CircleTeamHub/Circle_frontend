import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import {
  type BlockedUser,
  fetchBlockedUsers,
  removeFriendFromBlacklist,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  stateBlock: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  textBlock: {
    flex: 1,
    gap: 4,
  },
  button: {
    minHeight: 36,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function formatDate(value: string, fallback: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString();
}

export default function BlacklistSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      content: { paddingBottom: insets.bottom + Spacing.xl },
      card: { backgroundColor: colors.surface },
      title: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '700' as const,
      },
      caption: { color: colors.textSecondary, ...Typography.caption },
      button: { borderColor: colors.error },
      buttonText: {
        color: colors.error,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      error: { color: colors.error, ...Typography.caption },
    }),
    [colors, insets.bottom],
  );

  const loadUsers = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        setUsers(await fetchBlockedUsers());
      } catch (requestError) {
        setError(
          getApiErrorMessage(
            requestError,
            t('settingsDetails.privacy.blacklistLoadFailed'),
          ),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function removeBlockedUser(user: BlockedUser) {
    setSubmittingId(user.id);
    setError(null);
    try {
      await removeFriendFromBlacklist(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.privacy.blacklistRemoveFailed'),
        ),
      );
    } finally {
      setSubmittingId(null);
    }
  }

  function confirmRemove(user: BlockedUser) {
    Alert.alert(
      t('settingsDetails.privacy.blacklistRemoveTitle'),
      t('settingsDetails.privacy.blacklistRemoveMessage', {
        name: user.nickname,
      }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('settingsDetails.privacy.blacklistRemove'),
          style: 'destructive',
          onPress: () => void removeBlockedUser(user),
        },
      ],
    );
  }

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('settingsDetails.privacy.blacklist')} />
      <ScrollView
        contentContainerStyle={[s.content, d.content]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadUsers('refresh')}
            tintColor={colors.primary}
          />
        }
      >
        {loading ? (
          <View style={s.stateBlock}>
            <ActivityIndicator color={colors.primary} />
            <Text style={d.caption}>
              {t('settingsDetails.privacy.blacklistLoading')}
            </Text>
          </View>
        ) : users.length === 0 ? (
          <View style={s.stateBlock}>
            <Text style={d.caption}>
              {t('settingsDetails.privacy.blacklistEmpty')}
            </Text>
          </View>
        ) : (
          users.map((user) => (
            <View key={user.id} style={[s.card, d.card]}>
              <View style={s.row}>
                <Avatar uri={user.avatarUrl ?? undefined} size={44} />
                <View style={s.textBlock}>
                  <Text style={d.title}>{user.nickname}</Text>
                  <Text style={d.caption}>
                    {formatDate(
                      user.blockedAt,
                      t('settingsDetails.privacy.blacklistUnknownTime'),
                    )}
                  </Text>
                </View>
                <Pressable
                  style={[s.button, d.button]}
                  disabled={submittingId !== null}
                  onPress={() => confirmRemove(user)}
                >
                  <Text style={d.buttonText}>
                    {submittingId === user.id
                      ? t('common.loading', { defaultValue: '处理中' })
                      : t('settingsDetails.privacy.blacklistRemove')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
        {error ? <Text style={d.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}
