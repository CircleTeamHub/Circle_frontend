import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import {
  type BlockedUser,
  fetchBlockedUsers,
  removeFriendFromBlacklist,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const AVATAR_SIZE = 40;

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    flexGrow: 1,
  },
  stateBlock: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  // 所有人放进同一张卡片，行间用分隔线；首尾行各自带圆角。
  item: {
    paddingHorizontal: Spacing.md,
  },
  itemFirst: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  itemLast: {
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  row: {
    minHeight: 64,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  separatorInset: {
    marginLeft: AVATAR_SIZE + 12,
  },
  textBlock: {
    flex: 1,
    gap: Spacing.xs,
  },
  button: {
    minHeight: 32,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.6,
  },
  error: {
    paddingTop: Spacing.md,
    textAlign: 'center',
  },
});

function formatBlockedAt(value: string, t: TFunction) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('settingsDetails.privacy.blacklistUnknownTime');
  }
  return t('settingsDetails.privacy.blacklistBlockedAt', {
    date: date.toLocaleDateString(),
  });
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
      },
      caption: { color: colors.textSecondary, ...Typography.small },
      // 移出黑名单是解除限制，不是危险操作：用中性描边，不用红色。
      button: { borderColor: colors.surfaceBorder },
      buttonText: {
        color: colors.text,
        ...Typography.caption,
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

  const lastIndex = users.length - 1;

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('settingsDetails.privacy.blacklist')} />
      <FlatList
        data={loading ? [] : users}
        keyExtractor={(user) => user.id}
        contentContainerStyle={[s.content, d.content]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadUsers('refresh')}
            tintColor={colors.primary}
          />
        }
        ItemSeparatorComponent={() => (
          <View style={[s.item, d.card]}>
            <View style={s.separatorInset}>
              <Divider />
            </View>
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={s.stateBlock}>
              <ActivityIndicator color={colors.primary} />
              <Text style={d.caption}>
                {t('settingsDetails.privacy.blacklistLoading')}
              </Text>
            </View>
          ) : (
            <View style={s.stateBlock}>
              <Ionicons name="ban-outline" size={40} color={colors.textSecondary} />
              <Text style={d.caption}>
                {t('settingsDetails.privacy.blacklistEmpty')}
              </Text>
            </View>
          )
        }
        renderItem={({ item: user, index }) => (
          <View
            style={[
              s.item,
              d.card,
              index === 0 ? s.itemFirst : null,
              index === lastIndex ? s.itemLast : null,
            ]}
          >
            <View style={s.row}>
              <Avatar
                uri={user.avatarUrl ?? undefined}
                name={user.nickname}
                size={AVATAR_SIZE}
              />
              <View style={s.textBlock}>
                <Text style={d.title} numberOfLines={1}>
                  {user.nickname}
                </Text>
                <Text style={d.caption}>
                  {formatBlockedAt(user.blockedAt, t)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('settingsDetails.privacy.blacklistRemove')}
                style={({ pressed }) => [s.button, d.button, pressed ? s.buttonPressed : null]}
                disabled={submittingId !== null}
                onPress={() => confirmRemove(user)}
              >
                {submittingId === user.id ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Text style={d.buttonText}>
                    {t('settingsDetails.privacy.blacklistRemove')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
        ListFooterComponent={
          error ? <Text style={[s.error, d.error]}>{error}</Text> : null
        }
      />
    </View>
  );
}
