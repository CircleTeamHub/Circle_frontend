import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import {
  formatCacheSize,
  getAppStorageUsage,
  type AppStorageUsage,
} from '@/services/cache/clear-app-cache';

const EMPTY_USAGE: AppStorageUsage = {
  chatBytes: 0,
  cacheBytes: 0,
  temporaryBytes: 0,
  totalBytes: 0,
};

export default function StorageUsageScreen() {
  const [usage, setUsage] = useState(EMPTY_USAGE);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      getAppStorageUsage()
        .then((nextUsage) => {
          if (isActive) {
            setUsage(nextUsage);
          }
        })
        .catch(() => {
          if (isActive) {
            setUsage(EMPTY_USAGE);
          }
        });

      return () => {
        isActive = false;
      };
    }, []),
  );

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.storageUsage.title"
      sections={[
        {
          rows: [
            {
              id: 'chat-records',
              labelKey: 'settingsDetails.storageUsage.chatRecords',
              valueText: formatCacheSize(usage.chatBytes),
              type: 'info',
            },
            {
              id: 'cache-files',
              labelKey: 'settingsDetails.storageUsage.cacheFiles',
              valueText: formatCacheSize(usage.cacheBytes),
              type: 'info',
            },
            {
              id: 'temporary-files',
              labelKey: 'settingsDetails.storageUsage.temporaryFiles',
              valueText: formatCacheSize(usage.temporaryBytes),
              type: 'info',
            },
            {
              id: 'total',
              labelKey: 'settingsDetails.storageUsage.total',
              valueText: formatCacheSize(usage.totalBytes),
              type: 'info',
            },
          ],
        },
      ]}
    />
  );
}
