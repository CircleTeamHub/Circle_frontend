import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { clearAllLocalMessages } from '@/im/client';
import {
  clearAppCache,
  formatCacheSize,
  getAppCacheSize,
} from '@/services/cache/clear-app-cache';

export default function StorageSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [cacheSizeLabel, setCacheSizeLabel] = useState(
    t('appSettings.cacheCalculating'),
  );

  const refreshCacheSize = useCallback(() => {
    getAppCacheSize()
      .then((size) => setCacheSizeLabel(formatCacheSize(size)))
      .catch(() => setCacheSizeLabel(formatCacheSize(0)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCacheSize();
    }, [refreshCacheSize]),
  );

  const handleConfirmClearCache = () => {
    Alert.alert(
      t('settingsDetails.storage.clearCache'),
      t('settingsDetails.storage.clearCacheWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settingsDetails.storage.clearCacheAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await clearAppCache();
              refreshCacheSize();
              Alert.alert(
                t('settingsDetails.storage.cacheCleared'),
                result.failedEntries > 0
                  ? t('settingsDetails.storage.cachePartiallyCleared')
                  : t('settingsDetails.storage.cacheClearedMessage'),
              );
            } catch {
              Alert.alert(
                t('settingsDetails.storage.clearCacheFailed'),
                t('settingsDetails.storage.clearCacheFailedMessage'),
              );
            }
          },
        },
      ],
    );
  };

  const handleConfirmClearAllChats = () => {
    Alert.alert(
      t('settingsDetails.storage.clearAllChats'),
      t('settingsDetails.storage.clearAllChatsWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settingsDetails.storage.clearAllChatsAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllLocalMessages();
              Alert.alert(
                t('settingsDetails.storage.clearAllChatsDone'),
                t('settingsDetails.storage.clearAllChatsDoneMessage'),
              );
            } catch {
              Alert.alert(
                t('settingsDetails.storage.clearAllChatsFailed'),
                t('settingsDetails.storage.clearAllChatsFailedMessage'),
              );
            }
          },
        },
      ],
    );
  };

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.storage.title"
      sections={[
        {
          rows: [
            {
              id: 'storage-space',
              labelKey: 'settingsDetails.storage.storageSpace',
              onPress: () => router.push('/(tabs)/profile/settings-storage-usage' as never),
            },
            {
              id: 'clear-cache',
              labelKey: 'settingsDetails.storage.clearCache',
              valueText: cacheSizeLabel,
              destructive: true,
              onPress: handleConfirmClearCache,
            },
            {
              id: 'clear-all-chats',
              labelKey: 'settingsDetails.storage.clearAllChats',
              destructive: true,
              onPress: handleConfirmClearAllChats,
            },
          ],
        },
        {
          rows: [
            {
              id: 'switch-account',
              labelKey: 'settingsDetails.storage.switchAccount',
            },
            {
              id: 'logout',
              labelKey: 'settingsDetails.storage.logout',
              destructive: true,
            },
          ],
        },
      ]}
    />
  );
}
