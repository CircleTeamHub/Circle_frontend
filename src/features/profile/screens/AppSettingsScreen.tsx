import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import {
  OptionPickerSheet,
  type PickerOption,
} from '@/components/ui/option-picker-sheet';
import {
  getCurrentLanguagePreference,
  setLanguage,
  type AppLanguagePreference,
} from '@/i18n';
import { formatCacheSize, getAppCacheSize } from '@/services/cache/clear-app-cache';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type AppSettingsRowId =
  | 'profile'
  | 'accountSecurity'
  | 'notifications'
  | 'appearance'
  | 'language'
  | 'privacy'
  | 'permissions'
  | 'clearCache'
  | 'about';

interface AppSettingsRow {
  id: AppSettingsRowId;
  labelKey: string;
  route?: string;
  valueKey?: string;
  valueText?: string;
}

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
    id: 'language',
    labelKey: 'appSettings.rows.language.label',
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

const HELP_ROWS: AppSettingsRow[] = [
  {
    id: 'about',
    labelKey: 'appSettings.rows.about.label',
    route: '/(tabs)/profile/settings-about',
  },
];

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
});

export default function AppSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [cacheSizeLabel, setCacheSizeLabel] = useState(
    t('appSettings.cacheCalculating'),
  );
  const [languagePreference, setLanguagePreferenceState] = useState(
    getCurrentLanguagePreference(),
  );
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);

  const languageOptions = useMemo<PickerOption<AppLanguagePreference>[]>(
    () => [
      { label: t('appSettings.languageSheet.system'), value: 'system' },
      { label: t('appSettings.languageSheet.zh'), value: 'zh' },
      { label: t('appSettings.languageSheet.en'), value: 'en' },
    ],
    [t],
  );

  const handleOpenLanguageSheet = useCallback(() => {
    setLanguageSheetVisible(true);
  }, []);

  const handleCloseLanguageSheet = useCallback(() => {
    setLanguageSheetVisible(false);
  }, []);

  const handleSelectLanguage = useCallback((next: AppLanguagePreference) => {
    setLanguage(next);
    setLanguagePreferenceState(next);
  }, []);

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
        color: colors.textSecondary,
        ...Typography.body,
      },
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
        if (row.id === 'language') {
          return {
            ...row,
            valueText: t(`appSettings.languageSheet.${languagePreference}`),
          };
        }
        return row;
      }),
    [cacheSizeLabel, languagePreference, t],
  );

  const handleRowPress = (row: AppSettingsRow) => {
    if (row.id === 'language') {
      handleOpenLanguageSheet();
      return;
    }

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

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('appSettings.title')} />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.searchBox, d.searchBox]}>
          <Ionicons name="search-outline" size={26} color={colors.textSecondary} />
          <Text style={d.searchText}>{t('appSettings.searchPlaceholder')}</Text>
        </View>

        <View style={s.section}>
          <Text style={d.sectionTitle}>{t('appSettings.accountSection')}</Text>
          <View style={[s.card, d.card]}>{renderRows(ACCOUNT_ROWS)}</View>
        </View>

        <View style={s.section}>
          <Text style={d.sectionTitle}>{t('appSettings.generalSection')}</Text>
          <View style={[s.card, d.card]}>{renderRows(generalRows)}</View>
        </View>

        <View style={s.section}>
          <Text style={d.sectionTitle}>{t('appSettings.helpSection')}</Text>
          <View style={[s.card, d.card]}>{renderRows(HELP_ROWS)}</View>
        </View>
      </ScrollView>
      <OptionPickerSheet
        visible={languageSheetVisible}
        title={t('appSettings.languageSheet.title')}
        options={languageOptions}
        selectedValue={languagePreference}
        onSelect={handleSelectLanguage}
        onClose={handleCloseLanguageSheet}
      />
    </View>
  );
}
