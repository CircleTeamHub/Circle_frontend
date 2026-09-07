import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
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
import {
  useAppSettingsStore,
} from '@/features/profile/store/use-app-settings-store';

export default function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { themeMode, setThemeMode } = useTheme();
  const hideChatAvatar = useAppSettingsStore(
    (state) => state.settings.hideChatAvatar,
  );
  const mergeAvatar = useAppSettingsStore(
    (state) => state.settings.mergeAvatar,
  );
  const pinnedFoldCount = useAppSettingsStore((state) => state.pinnedFoldCount);
  const setSetting = useAppSettingsStore((state) => state.setSetting);
  const setPinnedFoldCount = useAppSettingsStore(
    (state) => state.setPinnedFoldCount,
  );
  const [themeSheetVisible, setThemeSheetVisible] = useState(false);
  const [languagePreference, setLanguagePreferenceState] = useState(
    getCurrentLanguagePreference(),
  );
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);
  const [pinnedFoldSheetVisible, setPinnedFoldSheetVisible] = useState(false);

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
  const pinnedFoldOptions = useMemo<PickerOption<number>[]>(
    () => [
      { label: '3', value: 3 },
      { label: '5', value: 5 },
      { label: '10', value: 10 },
      { label: '20', value: 20 },
      {
        label: t('settingsDetails.appearance.unlimited'),
        value: 0,
      },
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
              {
                id: 'global-chat-background',
                labelKey: 'settingsDetails.appearance.globalChatBackground',
                valueKey: 'settingsDetails.appearance.configured',
                onPress: () =>
                  router.push({
                    pathname: '/(tabs)/profile/settings-chat-background',
                    params: { scope: 'global' },
                  }),
              },
              {
                id: 'hide-chat-avatar',
                labelKey: 'settingsDetails.appearance.hideChatAvatar',
                subtitleKey: 'settingsDetails.appearance.hideChatAvatarHint',
                type: 'toggle',
                value: hideChatAvatar,
                onValueChange: (value) => setSetting('hideChatAvatar', value),
              },
              {
                id: 'merge-avatar',
                labelKey: 'settingsDetails.appearance.mergeAvatar',
                subtitleKey: 'settingsDetails.appearance.mergeAvatarHint',
                type: 'toggle',
                value: mergeAvatar,
                onValueChange: (value) => setSetting('mergeAvatar', value),
              },
              {
                id: 'pinned-fold-count',
                labelKey: 'settingsDetails.appearance.pinnedFoldCount',
                subtitleKey: 'settingsDetails.appearance.pinnedFoldCountHint',
                valueText:
                  pinnedFoldCount === 0
                    ? t('settingsDetails.appearance.unlimited')
                    : String(pinnedFoldCount),
                onPress: () => setPinnedFoldSheetVisible(true),
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
      <OptionPickerSheet
        visible={pinnedFoldSheetVisible}
        title={t('settingsDetails.appearance.pinnedFoldCount')}
        options={pinnedFoldOptions}
        selectedValue={pinnedFoldCount}
        onSelect={setPinnedFoldCount}
        onClose={() => setPinnedFoldSheetVisible(false)}
      />
    </View>
  );
}
