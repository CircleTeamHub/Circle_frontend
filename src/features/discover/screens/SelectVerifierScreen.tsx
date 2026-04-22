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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { Divider } from '@/components/ui/divider';
import { Spacing, Typography, useTheme } from '@/theme';
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
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();
  const { id: invitationId } = useLocalSearchParams<{
    id: string;
    circleId: string;
  }>();

  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchFriends();
        setFriends(data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      name: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      accountId: { color: colors.textSecondary, ...Typography.caption },
      selectBtn: { backgroundColor: colors.primary },
      selectText: { color: colors.white, ...Typography.caption, fontWeight: '600' as const },
    }),
    [colors],
  );

  const handleSelect = useCallback(
    async (friend: FriendProfile) => {
      if (!invitationId || submittingId) return;
      setSubmittingId(friend.id);
      try {
        await addVerifierToInvitation(invitationId, friend.id);
        Alert.alert('已邀请', `已邀请 ${friend.nickname} 进行验证`);
        router.back();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : '添加验证人失败';
        Alert.alert('添加失败', message);
      } finally {
        setSubmittingId(null);
      }
    },
    [invitationId, submittingId, router],
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
              <Text style={d.selectText}>选择</Text>
            )}
          </Pressable>
        </View>
        <Divider />
      </View>
    ),
    [handleSelect, d, submittingId, colors],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="选择验证人" />
      {loading ? (
        <View style={s.centerLoader}>
          <ActivityIndicator color={colors.primary} />
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
                暂无好友
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
