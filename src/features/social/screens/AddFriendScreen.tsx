import { Avatar } from '@/components/ui/avatar';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { NavHeader } from '@/components/ui/nav-header';
import {
  getUserProfileHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import {
  searchUsersByAccountId,
  type PublicUser,
} from '@/services/api/users';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

type SearchState = 'idle' | 'loading' | 'result' | 'not-found' | 'error';

const s = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
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
  quickActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  quickAction: {
    flex: 1,
    height: 48,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
});

function getDisplayName(user: PublicUser) {
  return user.nickname?.trim() || user.accountId;
}

export default function AddFriendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  // 按本屏所在 tab 栈(messages / contacts 都有 re-export)推断 scope，
  // 打开搜到的用户 profile 时进同一个栈——否则会串栈污染导航。
  const scope = getUserProfileScopeFromSegments(segments);
  const { colors } = useTheme();
  const { t } = useTranslation();
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
      quickAction: {
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.surfaceBorder,
      },
      quickActionText: {
        color: colors.text,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
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
    } catch (error) {
      setResult(null);
      setSearchState('error');
      if (__DEV__) {
        console.warn('[AddFriendScreen] searchUsersByAccountId failed', error);
      }
    }
  }, [keyword, searchState]);

  const openUserProfile = useCallback(() => {
    if (!result) {
      return;
    }

    router.push(
      getUserProfileHref(scope, result.id, getDisplayName(result)),
    );
  }, [result, router, scope]);

  // 微信「添加朋友」页同款双入口:出示我的名片码 / 扫对方的码。
  const handleOpenMyQr = useCallback(() => {
    router.push({ pathname: '/qr-code', params: { type: 'user' } });
  }, [router]);

  const handleOpenScan = useCallback(() => {
    router.push('/(tabs)/messages/scan');
  }, [router]);

  return (
    <View
      testID={E2E_TEST_IDS.addFriendScreen}
      style={[d.container, { paddingTop: insets.top }]}
    >
      <NavHeader
        title={t('addFriend.title', { defaultValue: '添加好友' })}
      />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={s.searchRow}>
          <View style={[s.searchInput, d.searchInput]}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              testID={E2E_TEST_IDS.addFriendInput}
              value={keyword}
              onChangeText={setKeyword}
              onSubmitEditing={handleSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              placeholder={t('addFriend.placeholder', {
                defaultValue: '输入对方账号',
              })}
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
              <Text style={d.searchButtonText}>
                {t('common.search', { defaultValue: '搜索' })}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={s.quickActions}>
          <Pressable
            style={[s.quickAction, d.quickAction]}
            onPress={handleOpenMyQr}
            accessibilityRole="button"
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
            <Text style={d.quickActionText}>
              {t('qr.myQrEntry', { defaultValue: '我的二维码' })}
            </Text>
          </Pressable>
          <Pressable
            style={[s.quickAction, d.quickAction]}
            onPress={handleOpenScan}
            accessibilityRole="button"
          >
            <Ionicons name="scan-outline" size={20} color={colors.primary} />
            <Text style={d.quickActionText}>
              {t('messages.scan', { defaultValue: '扫一扫' })}
            </Text>
          </Pressable>
        </View>

        <View style={s.statusBlock}>
          {searchState === 'not-found' ? (
            <Text style={d.stateText}>
              {t('addFriend.notFound', { defaultValue: '未找到好友' })}
            </Text>
          ) : null}

          {searchState === 'error' ? (
            <Text style={d.stateText}>
              {t('addFriend.searchFailed', {
                defaultValue: '搜索失败，请稍后重试',
              })}
            </Text>
          ) : null}

          {searchState === 'result' && result ? (
            <Pressable
              testID={E2E_TEST_IDS.addFriendResult(result.id)}
              style={s.resultRow}
              onPress={openUserProfile}
            >
              <Avatar
                size={52}
                name={getDisplayName(result)}
                uri={result.avatarUrl ?? undefined}
              />
              <View style={s.resultMeta}>
                <Text style={d.resultName}>{getDisplayName(result)}</Text>
                <Text style={d.resultAccount}>
                  {t('contacts.accountId', { id: result.accountId })}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
