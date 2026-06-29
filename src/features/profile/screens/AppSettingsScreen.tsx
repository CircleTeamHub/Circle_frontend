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
import { formatCacheSize, getAppCacheSize } from '@/services/cache/clear-app-cache';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

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
}

type Translate = ReturnType<typeof useTranslation>['t'];

const ACCOUNT_ROWS: AppSettingsRow[] = [
  {
    id: 'profile',
    labelKey: 'appSettings.rows.profile.label',
    route: '/(tabs)/profile/settings',
  },
  {
    id: 'accountSecurity',
    labelKey: 'appSettings.rows.accountSecurity.label',
    route: '/(tabs)/profile/settings-account-security',
  },
];

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
  route: {
    pathname: '/(tabs)/profile/edit/[field]',
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
  ...PROFILE_SEARCH_ROWS,
  ...ACCOUNT_SECURITY_SEARCH_ROWS,
];

const GENERAL_ROWS: AppSettingsRow[] = [
  {
    id: 'notifications',
    labelKey: 'appSettings.rows.notifications.label',
    route: '/(tabs)/profile/settings-notifications',
  },
  {
    id: 'appearance',
    labelKey: 'appSettings.rows.appearance.label',
    route: '/(tabs)/profile/settings-appearance',
  },
  {
    id: 'privacy',
    labelKey: 'appSettings.rows.privacy.label',
    route: '/(tabs)/profile/settings-privacy',
  },
  {
    id: 'permissions',
    labelKey: 'appSettings.rows.permissions.label',
    route: '/(tabs)/profile/settings-permissions',
  },
  {
    id: 'clearCache',
    labelKey: 'appSettings.rows.clearCache.label',
    route: '/(tabs)/profile/settings-storage',
  },
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
  'circleRingtone',
  'offlineReminder',
].map((key) => ({
  id: `notifications-${key}`,
  labelKey: `settingsDetails.notifications.${key}`,
  route: '/(tabs)/profile/settings-notifications',
}));

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
    id: 'storage-settings',
    labelKey: 'settingsDetails.storage.title',
    route: '/(tabs)/profile/settings-storage',
  },
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
  ...NOTIFICATION_SEARCH_ROWS,
  ...APPEARANCE_SEARCH_ROWS,
  ...PRIVACY_SEARCH_ROWS,
  ...PERMISSIONS_SEARCH_ROWS,
  ...STORAGE_SEARCH_ROWS,
];

const HELP_ROWS: AppSettingsRow[] = [
  {
    id: 'about',
    labelKey: 'appSettings.rows.about.label',
    route: '/(tabs)/profile/settings-about',
  },
];

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
];

const HELP_SEARCH_ROWS = [...HELP_ROWS, ...ABOUT_SEARCH_ROWS];

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
  searchBox: {
    height: 54,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    minHeight: 24,
  },
  card: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
});

export default function AppSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
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
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.xl,
      },
      searchBox: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      searchText: {
        color: colors.text,
        ...Typography.body,
      },
      searchPlaceholder: colors.textSecondary,
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '700' as const,
      },
      card: {
        backgroundColor: colors.surface,
        boxShadow: '0 10px 26px rgba(59, 130, 246, 0.08)',
      },
      rowLabel: {
        color: colors.text,
        ...Typography.body,
      },
      rowValue: {
        color: colors.textSecondary,
        ...Typography.caption,
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
          if (__DEV__) {
            console.warn('[AppSettingsScreen] getAppCacheSize failed', error);
          }
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

  const renderRows = (rows: AppSettingsRow[]) =>
    rows.map((row, index) => {
      const valueText = row.valueText ?? (row.valueKey ? t(row.valueKey) : null);

      return (
        <View key={row.id}>
          <Pressable style={s.row} onPress={() => handleRowPress(row)}>
            <Text style={d.rowLabel}>{t(row.labelKey)}</Text>
            <View style={s.rowRight}>
              {valueText ? <Text style={d.rowValue}>{valueText}</Text> : null}
              <Ionicons
                name="chevron-forward"
                size={22}
                color={colors.textSecondary}
              />
            </View>
          </Pressable>
          {index < rows.length - 1 ? <Divider /> : null}
        </View>
      );
    });

  const renderSection = (
    titleKey: string,
    rows: AppSettingsRow[],
  ) => {
    if (rows.length === 0) return null;

    return (
      <View style={s.section}>
        <Text style={d.sectionTitle}>{t(titleKey)}</Text>
        <View style={[s.card, d.card]}>{renderRows(rows)}</View>
      </View>
    );
  };

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('appSettings.title')} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={[s.searchBox, d.searchBox]}>
          <Ionicons name="search-outline" size={26} color={colors.textSecondary} />
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
            <Text style={d.rowValue}>{t('appSettings.searchNoResults')}</Text>
          </View>
        )}
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
