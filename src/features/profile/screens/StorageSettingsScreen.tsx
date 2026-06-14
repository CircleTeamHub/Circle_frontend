import { useRouter } from 'expo-router';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { useStorageActions } from '@/features/profile/hooks/use-storage-actions';

export default function StorageSettingsScreen() {
  const router = useRouter();
  const {
    cacheSizeLabel,
    busy,
    confirmClearCache,
    confirmClearChats,
  } = useStorageActions();

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.storage.title"
      sections={[
        {
          rows: [
            {
              id: 'storage-space',
              labelKey: 'settingsDetails.storage.storageSpace',
              disabled: busy,
              onPress: () =>
                router.push('/(tabs)/profile/settings-storage-usage' as never),
            },
            {
              id: 'clear-cache',
              labelKey: 'settingsDetails.storage.clearCache',
              valueText: cacheSizeLabel,
              destructive: true,
              disabled: busy,
              onPress: confirmClearCache,
            },
            {
              id: 'clear-all-chats',
              labelKey: 'settingsDetails.storage.clearAllChats',
              destructive: true,
              disabled: busy,
              onPress: confirmClearChats,
            },
          ],
        },
      ]}
    />
  );
}
