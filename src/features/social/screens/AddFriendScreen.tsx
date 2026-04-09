import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { getUserProfileHref } from '@/features/user/utils/routes';
import {
  searchUsersByAccountId,
  type PublicUser,
} from '@/services/api/users';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SearchState = 'idle' | 'loading' | 'result' | 'not-found' | 'error';

const s = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderRadius: Radius.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  searchText: {
    flex: 1,
    ...Typography.bodyRegular,
  },
  searchButton: {
    minWidth: 88,
    height: 48,
    borderRadius: Radius.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  resultMeta: {
    flex: 1,
    gap: 4,
  },
  statusBlock: {
    minHeight: 80,
    justifyContent: 'center',
  },
});

function getDisplayName(user: PublicUser) {
  return user.nickname?.trim() || user.accountId;
}

export default function AddFriendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const [keyword, setKeyword] = useState('');
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [result, setResult] = useState<PublicUser | null>(null);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      searchInput: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      searchText: {
        color: colors.text,
      },
      searchButton: {
        backgroundColor: colors.primary,
      },
      searchButtonDisabled: {
        opacity: 0.5,
      },
      searchButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      resultName: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      resultAccount: {
        color: colors.textSecondary,
        ...Typography.small,
      },
    }),
    [colors],
  );

  const handleSearch = useCallback(async () => {
    const trimmed = keyword.trim();

    if (!trimmed || searchState === 'loading') {
      return;
    }

    Keyboard.dismiss();
    setSearchState('loading');

    try {
      const user = await searchUsersByAccountId(trimmed);
      setResult(user);
      setSearchState(user ? 'result' : 'not-found');
    } catch {
      setResult(null);
      setSearchState('error');
    }
  }, [keyword, searchState]);

  const openUserProfile = useCallback(() => {
    if (!result) {
      return;
    }

    router.push(
      getUserProfileHref('contacts', result.id, getDisplayName(result)),
    );
  }, [result, router]);

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="添加好友" />
      <View style={s.content}>
        <View style={s.searchRow}>
          <View style={[s.searchInput, d.searchInput]}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              value={keyword}
              onChangeText={setKeyword}
              onSubmitEditing={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              placeholder="输入对方账号"
              placeholderTextColor={colors.textSecondary}
              style={[s.searchText, d.searchText]}
            />
          </View>
          <Pressable
            style={[
              s.searchButton,
              d.searchButton,
              keyword.trim() ? null : d.searchButtonDisabled,
            ]}
            disabled={!keyword.trim() || searchState === 'loading'}
            onPress={handleSearch}
          >
            {searchState === 'loading' ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={d.searchButtonText}>搜索</Text>
            )}
          </Pressable>
        </View>

        <View style={s.statusBlock}>
          {searchState === 'not-found' ? (
            <Text style={d.stateText}>未找到好友</Text>
          ) : null}

          {searchState === 'error' ? (
            <Text style={d.stateText}>搜索失败，请稍后重试</Text>
          ) : null}

          {searchState === 'result' && result ? (
            <Pressable style={s.resultRow} onPress={openUserProfile}>
              <Avatar
                size={52}
                name={getDisplayName(result)}
                uri={result.avatarUrl ?? undefined}
              />
              <View style={s.resultMeta}>
                <Text style={d.resultName}>{getDisplayName(result)}</Text>
                <Text style={d.resultAccount}>账号：{result.accountId}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
