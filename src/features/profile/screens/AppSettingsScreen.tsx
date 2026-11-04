import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import {
  SettingsSectionView,
  type SettingsDetailRow,
} from '@/features/profile/components/settings-detail';
import { formatCacheSize, getAppCacheSize } from '@/services/cache/clear-app-cache';
import { Radius, Spacing, Typography, iconForeground, useTheme, withAlpha } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { useAuth } from '@/hooks/use-auth';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { reportHandledFailure } from '@/observability/report-failure';

type AppSettingsRoute =
  | string
  | {
      pathname: string;
      params?: Record<string, string>;
    };

interface AppSettingsRow {
  id: string;
  labelKey: string;
  route?: AppSettingsRoute;
  valueKey?: string;
  valueText?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** 图标色，沿用「我的」页宫格的同一组色值。 */
  accent?: string;
  /** 搜索结果所在的设置页，显示在标题下面。 */
  parentLabelKey?: string;
}

type Translate = ReturnType<typeof useTranslation>['t'];

const PROFILE_ROW: AppSettingsRow = {
  id: 'profile',
  labelKey: 'appSettings.rows.profile.label',
  route: '/(tabs)/profile/settings',
  icon: 'person-circle-outline',
  accent: '#387BE5',
};
const ACCOUNT_SECURITY_ROW: AppSettingsRow = {
  id: 'accountSecurity',
  labelKey: 'appSettings.rows.accountSecurity.label',
  route: '/(tabs)/profile/settings-account-security',
  icon: 'shield-checkmark-outline',
  accent: '#168C91',
};
const ACCOUNT_ROWS = [PROFILE_ROW, ACCOUNT_SECURITY_ROW];

// 搜索命中的子项带上所在页面的图标和名称，同名项也分得清在哪一页。
function underPage(page: AppSettingsRow, rows: AppSettingsRow[]): AppSettingsRow[] {
  return rows.map((row) => ({
    ...row,
    icon: page.icon,
    accent: page.accent,
    parentLabelKey: page.labelKey,
  }));
}

const PROFILE_SEARCH_ROWS: AppSettingsRow[] = [
  'avatar',
  'nickname',
  'gender',
  'birthday',
  'city',
  'bio',
  'wechat',
  'phone',
  'qq',
].map((field) => ({
  id: `profile-${field}`,
  labelKey: `profileFields.${field}`,
  // 落到个人信息页并直接弹出该字段的底部编辑面板。
  route: {
    pathname: '/(tabs)/profile/settings',
    params: { field },
  },
}));

const ACCOUNT_SECURITY_SEARCH_ROWS: AppSettingsRow[] = [
  {
    id: 'account-security-change-password',
    labelKey: 'settingsDetails.accountSecurity.changePassword',
    route: '/(tabs)/profile/change-password',
  },
  {
    id: 'account-security-enable-login-security-code',
    labelKey: 'settingsDetails.accountSecurity.enableLoginSecurityCode',
    route: '/(tabs)/profile/settings-account-security',
  },
  {
    id: 'account-security-change-login-security-code',
    labelKey: 'settingsDetails.accountSecurity.changeLoginSecurityCode',
    valueKey: 'settingsDetails.accountSecurity.securityCodeHint',
    route: {
      pathname: '/(tabs)/profile/change-security-code',
      params: { mode: 'change' },
    },
  },
  {
    id: 'account-security-single-device-login',
    labelKey: 'settingsDetails.accountSecurity.singleDeviceLogin',
    route: '/(tabs)/profile/settings-account-security',
  },
  {
    id: 'account-security-login-device-management',
    labelKey: 'settingsDetails.accountSecurity.loginDeviceManagement',
    route: '/(tabs)/profile/login-devices',
  },
  {
    id: 'account-security-cancel-account',
    labelKey: 'settingsDetails.accountSecurity.cancelAccount',
    route: '/(tabs)/profile/settings-account-security',
  },
];

const ACCOUNT_SEARCH_ROWS = [
  ...ACCOUNT_ROWS,
  ...underPage(PROFILE_ROW, PROFILE_SEARCH_ROWS),
  ...underPage(ACCOUNT_SECURITY_ROW, ACCOUNT_SECURITY_SEARCH_ROWS),
];

const NOTIFICATIONS_ROW: AppSettingsRow = {
  id: 'notifications',
  labelKey: 'appSettings.rows.notifications.label',
  route: '/(tabs)/profile/settings-notifications',
  icon: 'notifications-outline',
  accent: '#D97732',
};
const APPEARANCE_ROW: AppSettingsRow = {
  id: 'appearance',
  labelKey: 'appSettings.rows.appearance.label',
  route: '/(tabs)/profile/settings-appearance',
  icon: 'color-palette-outline',
  accent: '#8B5CF6',
};
const PRIVACY_ROW: AppSettingsRow = {
  id: 'privacy',
  labelKey: 'appSettings.rows.privacy.label',
  route: '/(tabs)/profile/settings-privacy',
  icon: 'lock-closed-outline',
  accent: '#6366F1',
};
const PERMISSIONS_ROW: AppSettingsRow = {
  id: 'permissions',
  labelKey: 'appSettings.rows.permissions.label',
  route: '/(tabs)/profile/settings-permissions',
  icon: 'key-outline',
  accent: '#D95688',
};
const STORAGE_ROW: AppSettingsRow = {
  id: 'clearCache',
  labelKey: 'appSettings.rows.clearCache.label',
  route: '/(tabs)/profile/settings-storage',
  icon: 'server-outline',
  accent: '#168C91',
};
const GENERAL_ROWS = [
  NOTIFICATIONS_ROW,
  APPEARANCE_ROW,
  PRIVACY_ROW,
  PERMISSIONS_ROW,
  STORAGE_ROW,
];

const NOTIFICATION_SEARCH_ROWS: AppSettingsRow[] = [
  'push',
  'vibration',
  'sound',
  'messageRingtone',
  'friendRequest',
  'groupRequest',
  'groupGlobal',
  'groupOnline',
  'groupOffline',
  'circleGlobal',
  'circleSound',
  'circleOffline',
  'circleRingtone',
].map((key) => ({
  id: `notifications-${key}`,
  labelKey: `settingsDetails.notifications.${key}`,
  route: '/(tabs)/profile/settings-notifications',
}));

// 私信自动回复归到消息通知下面，但搜索仍然直达它自己那一页。
NOTIFICATION_SEARCH_ROWS.push({
  id: 'notifications-auto-reply',
  labelKey: 'settingsDetails.notifications.autoReply',
  route: '/(tabs)/profile/settings-auto-reply',
});

const APPEARANCE_SEARCH_ROWS: AppSettingsRow[] = [
  {
    id: 'appearance-theme-mode',
    labelKey: 'settingsDetails.appearance.themeMode',
    route: '/(tabs)/profile/settings-appearance',
  },
  {
    id: 'appearance-language',
    labelKey: 'settingsDetails.appearance.language',
    route: '/(tabs)/profile/settings-appearance',
  },
  {
    id: 'appearance-global-chat-background',
    labelKey: 'settingsDetails.appearance.globalChatBackground',
    route: '/(tabs)/profile/settings-appearance',
  },
  {
    id: 'appearance-hide-chat-avatar',
    labelKey: 'settingsDetails.appearance.hideChatAvatar',
    route: '/(tabs)/profile/settings-appearance',
  },
  {
    id: 'appearance-merge-avatar',
    labelKey: 'settingsDetails.appearance.mergeAvatar',
    route: '/(tabs)/profile/settings-appearance',
  },
  {
    id: 'appearance-pinned-fold-count',
    labelKey: 'settingsDetails.appearance.pinnedFoldCount',
    route: '/(tabs)/profile/settings-appearance',
  },
];

const PRIVACY_SEARCH_ROWS: AppSettingsRow[] = [
  {
    id: 'privacy-self-destruct',
    labelKey: 'settingsDetails.privacy.selfDestruct',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-blacklist',
    labelKey: 'settingsDetails.privacy.blacklist',
    route: '/(tabs)/profile/settings-blacklist',
  },
  {
    id: 'privacy-moments-visibility',
    labelKey: 'settingsDetails.privacy.momentsVisibility',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-stranger-message',
    labelKey: 'settingsDetails.privacy.strangerMessage',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-show-phone',
    labelKey: 'settingsDetails.privacy.showPhone',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-show-email',
    labelKey: 'settingsDetails.privacy.showEmail',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-show-wechat',
    labelKey: 'settingsDetails.privacy.showWechat',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-show-qq',
    labelKey: 'settingsDetails.privacy.showQQ',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-add-me-methods',
    labelKey: 'settingsDetails.privacy.addMeMethods',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-call-permission',
    labelKey: 'settingsDetails.privacy.callPermission',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'privacy-group-invite-permission',
    labelKey: 'settingsDetails.privacy.groupInvitePermission',
    route: '/(tabs)/profile/settings-privacy',
  },
];

const PERMISSIONS_SEARCH_ROWS: AppSettingsRow[] = [
  'location',
  'microphone',
  'camera',
  'photoLibrary',
  'notifications',
].map((key) => ({
  id: `permissions-${key}`,
  labelKey: `settingsDetails.permissions.${key}`,
  route: '/(tabs)/profile/settings-permissions',
}));

const STORAGE_SEARCH_ROWS: AppSettingsRow[] = [
  {
    id: 'storage-space',
    labelKey: 'settingsDetails.storage.storageSpace',
    route: '/(tabs)/profile/settings-storage-usage',
  },
  {
    id: 'storage-clear-all-chats',
    labelKey: 'settingsDetails.storage.clearAllChats',
    route: '/(tabs)/profile/settings-storage',
  },
];

const GENERAL_SEARCH_ROWS = [
  ...GENERAL_ROWS,
  ...underPage(NOTIFICATIONS_ROW, NOTIFICATION_SEARCH_ROWS),
  ...underPage(APPEARANCE_ROW, APPEARANCE_SEARCH_ROWS),
  ...underPage(PRIVACY_ROW, PRIVACY_SEARCH_ROWS),
  ...underPage(PERMISSIONS_ROW, PERMISSIONS_SEARCH_ROWS),
  ...underPage(STORAGE_ROW, STORAGE_SEARCH_ROWS),
];

const ABOUT_ROW: AppSettingsRow = {
  id: 'about',
  labelKey: 'appSettings.rows.about.label',
  route: '/(tabs)/profile/settings-about',
  icon: 'information-circle-outline',
  accent: '#6366F1',
};
const HELP_ROWS = [ABOUT_ROW];

const ABOUT_SEARCH_ROWS: AppSettingsRow[] = [
  {
    id: 'about-product-intro',
    labelKey: 'settingsDetails.about.productIntro',
    route: '/(tabs)/profile/settings-about-product',
  },
  {
    id: 'about-version',
    labelKey: 'settingsDetails.about.version',
    route: '/(tabs)/profile/settings-about-version',
  },
  {
    id: 'about-user-agreement',
    labelKey: 'settingsDetails.about.userAgreement',
    route: '/(tabs)/profile/settings-about-user-agreement',
  },
  {
    id: 'about-privacy-policy',
    labelKey: 'settingsDetails.about.privacyPolicy',
    route: '/(tabs)/profile/settings-about-privacy-policy',
  },
  {
    id: 'about-check-updates',
    labelKey: 'settingsDetails.about.checkUpdates',
    route: '/(tabs)/profile/settings-about-version',
  },
  {
    id: 'about-third-party-licenses',
    labelKey: 'settingsDetails.about.thirdPartyLicenses',
    route: '/(tabs)/profile/settings-about-licenses',
  },
];

const HELP_SEARCH_ROWS = [...HELP_ROWS, ...underPage(ABOUT_ROW, ABOUT_SEARCH_ROWS)];

const s = StyleSheet.create({
  searchBox: {
    height: 44,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    minHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  // 切换账号 / 退出登录：单独一张卡，两行居中，退出登录用红字而不是整块红按钮。
  footer: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    overflow: 'hidden',
  },
  footerAction: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerActionPressed: {
    opacity: 0.6,
  },
  footerActionDisabled: {
    opacity: 0.5,
  },
});

export default function AppSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, resolvedMode } = useTheme();
  const { t } = useTranslation();
  const { logout, switchAccount, submitting } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [cacheSizeLabel, setCacheSizeLabel] = useState(
    t('appSettings.cacheCalculating'),
  );

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.lg,
      },
      searchBox: {
        backgroundColor: colors.surface,
      },
      searchText: {
        color: colors.text,
        ...Typography.body,
      },
      searchPlaceholder: colors.textSecondary,
      card: {
        backgroundColor: colors.surface,
        boxShadow: '0 10px 26px rgba(59, 130, 246, 0.08)',
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      footerText: {
        color: colors.text,
        ...Typography.body,
      },
      footerDangerText: {
        color: colors.error,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors, insets.bottom],
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      getAppCacheSize()
        .then((size) => {
          if (isActive) {
            setCacheSizeLabel(formatCacheSize(size));
          }
        })
        .catch((error) => {
          if (isActive) {
            setCacheSizeLabel(formatCacheSize(0));
          }
          reportHandledFailure('appSettings', 'cacheSize', error);
        });

      return () => {
        isActive = false;
      };
    }, []),
  );

  const generalRows = useMemo(
    () =>
      GENERAL_ROWS.map((row) => {
        if (row.id === 'clearCache') {
          return { ...row, valueText: cacheSizeLabel };
        }
        return row;
      }),
    [cacheSizeLabel],
  );
  const generalSearchRows = useMemo(
    () =>
      GENERAL_SEARCH_ROWS.map((row) => {
        if (row.id === 'clearCache') {
          return { ...row, valueText: cacheSizeLabel };
        }
        return row;
      }),
    [cacheSizeLabel],
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedSearchQuery.length > 0;
  const filteredAccountRows = useMemo(
    () =>
      (isSearching ? ACCOUNT_SEARCH_ROWS : ACCOUNT_ROWS).filter((row) =>
        rowMatchesSearch(row, normalizedSearchQuery, t),
      ),
    [isSearching, normalizedSearchQuery, t],
  );
  const filteredGeneralRows = useMemo(
    () =>
      (isSearching ? generalSearchRows : generalRows).filter((row) =>
        rowMatchesSearch(row, normalizedSearchQuery, t),
      ),
    [generalRows, generalSearchRows, isSearching, normalizedSearchQuery, t],
  );
  const filteredHelpRows = useMemo(
    () =>
      (isSearching ? HELP_SEARCH_ROWS : HELP_ROWS).filter((row) =>
        rowMatchesSearch(row, normalizedSearchQuery, t),
      ),
    [isSearching, normalizedSearchQuery, t],
  );
  const hasSearchResults =
    filteredAccountRows.length > 0 ||
    filteredGeneralRows.length > 0 ||
    filteredHelpRows.length > 0;

  const handleRowPress = (row: AppSettingsRow) => {
    if (row.route) {
      router.push(row.route as never);
      return;
    }

    router.push('/(tabs)/profile/settings-storage' as never);
  };

  const toDetailRow = (row: AppSettingsRow): SettingsDetailRow => {
    const tint = row.accent ? iconForeground(row.accent, resolvedMode) : undefined;
    return {
      id: row.id,
      labelKey: row.labelKey,
      subtitleKey: row.parentLabelKey,
      valueKey: row.valueKey,
      valueText: row.valueText,
      icon: row.icon,
      iconColor: tint,
      iconBackgroundColor: tint
        ? withAlpha(tint, resolvedMode === 'dark' ? 0.16 : 0.1)
        : undefined,
      testID: E2E_TEST_IDS.settingsRow(row.id),
      onPress: () => handleRowPress(row),
    };
  };

  const renderSection = (titleKey: string, rows: AppSettingsRow[]) => (
    <SettingsSectionView section={{ titleKey, rows: rows.map(toDetailRow) }} />
  );

  return (
    <View
      testID={E2E_TEST_IDS.settingsScreen}
      style={[d.container, { paddingTop: insets.top }]}
    >
      <NavHeader title={t('appSettings.title')} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={[s.searchBox, d.searchBox]}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('appSettings.searchPlaceholder')}
            placeholderTextColor={d.searchPlaceholder}
            style={[s.searchInput, d.searchText]}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        {hasSearchResults ? (
          <>
            {renderSection('appSettings.accountSection', filteredAccountRows)}
            {renderSection('appSettings.generalSection', filteredGeneralRows)}
            {renderSection('appSettings.helpSection', filteredHelpRows)}
          </>
        ) : (
          <View style={s.emptyState}>
            <Ionicons name="search-outline" size={32} color={colors.textSecondary} />
            <Text style={d.emptyText}>{t('appSettings.searchNoResults')}</Text>
          </View>
        )}

        <View style={[s.footer, d.card]}>
          <Pressable
            testID={E2E_TEST_IDS.settingsLogout}
            accessibilityRole="button"
            accessibilityLabel={t('settingsPage.switchAccount')}
            style={({ pressed }) => [
              s.footerAction,
              pressed ? s.footerActionPressed : null,
              submitting ? s.footerActionDisabled : null,
            ]}
            onPress={switchAccount}
            disabled={submitting}
          >
            <Text style={d.footerText}>{t('settingsPage.switchAccount')}</Text>
          </Pressable>
          <Divider />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settingsPage.logout')}
            style={({ pressed }) => [
              s.footerAction,
              pressed ? s.footerActionPressed : null,
              submitting ? s.footerActionDisabled : null,
            ]}
            onPress={logout}
            disabled={submitting}
          >
            <Text style={d.footerDangerText}>{t('settingsPage.logout')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function rowMatchesSearch(
  row: AppSettingsRow,
  normalizedSearchQuery: string,
  t: Translate,
) {
  if (!normalizedSearchQuery) return true;

  const label = t(row.labelKey).toLowerCase();
  const value = (row.valueText ?? (row.valueKey ? t(row.valueKey) : '')).toLowerCase();

  return label.includes(normalizedSearchQuery) || value.includes(normalizedSearchQuery);
}
