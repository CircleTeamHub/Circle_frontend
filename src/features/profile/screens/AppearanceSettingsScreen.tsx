import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  OptionPickerSheet,
  type PickerOption,
} from '@/components/ui/option-picker-sheet';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import {
  APP_LANGUAGE_OPTIONS,
  getCurrentLanguagePreference,
  setLanguage,
  type AppLanguagePreference,
} from '@/i18n';
import { useTheme, type ThemeMode } from '@/theme';

export default function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();
  const [themeSheetVisible, setThemeSheetVisible] = useState(false);
  const [languagePreference, setLanguagePreferenceState] = useState(
    getCurrentLanguagePreference(),
  );
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);

  const themeOptions = useMemo<PickerOption<ThemeMode>[]>(
    () => [
      {
        label: t('settingsDetails.appearance.themeSheet.system'),
        value: 'system',
      },
      {
        label: t('settingsDetails.appearance.themeSheet.light'),
        value: 'light',
      },
      {
        label: t('settingsDetails.appearance.themeSheet.dark'),
        value: 'dark',
      },
    ],
    [t],
  );

  const languageOptions = useMemo<PickerOption<AppLanguagePreference>[]>(
    () => [
      { label: t('appSettings.languageSheet.system'), value: 'system' },
      ...APP_LANGUAGE_OPTIONS.map((option) => ({
        label: t(option.labelKey),
        value: option.value,
      })),
    ],
    [t],
  );

  function handleSelectLanguage(next: AppLanguagePreference) {
    setLanguage(next);
    setLanguagePreferenceState(next);
  }

  return (
    <View style={{ flex: 1 }}>
      <SettingsDetailScreen
        titleKey="settingsDetails.appearance.title"
        sections={[
          {
            rows: [
              {
                id: 'theme-mode',
                labelKey: 'settingsDetails.appearance.themeMode',
                valueText: t(`settingsDetails.appearance.themeSheet.${themeMode}`),
                onPress: () => setThemeSheetVisible(true),
              },
              {
                id: 'language',
                labelKey: 'settingsDetails.appearance.language',
                valueText: t(`appSettings.languageSheet.${languagePreference}`),
                onPress: () => setLanguageSheetVisible(true),
              },
            ],
          },
        ]}
      />
      <OptionPickerSheet
        visible={themeSheetVisible}
        title={t('settingsDetails.appearance.themeSheet.title')}
        options={themeOptions}
        selectedValue={themeMode}
        onSelect={setThemeMode}
        onClose={() => setThemeSheetVisible(false)}
      />
      <OptionPickerSheet
        visible={languageSheetVisible}
        title={t('appSettings.languageSheet.title')}
        options={languageOptions}
        selectedValue={languagePreference}
        onSelect={handleSelectLanguage}
        onClose={() => setLanguageSheetVisible(false)}
      />
    </View>
  );
}
