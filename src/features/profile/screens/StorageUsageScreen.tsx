import { useTranslation } from 'react-i18next';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import { useStorageUsage } from '@/features/profile/hooks/use-storage-usage';
import { formatCacheSize } from '@/services/cache/clear-app-cache';

export default function StorageUsageScreen() {
  const { t } = useTranslation();
  const { usage, loading, loadFailed, retry } = useStorageUsage();

  const formatRowValue = (bytes: number) => {
    if (loadFailed) return '—';
    if (loading) return t('common.loading');
    return formatCacheSize(bytes);
  };

  const rows = [
    {
      id: 'chat-records',
      labelKey: 'settingsDetails.storageUsage.chatRecords',
      valueText: formatRowValue(usage.chatBytes),
      type: 'info' as const,
    },
    {
      id: 'cache-files',
      labelKey: 'settingsDetails.storageUsage.cacheFiles',
      valueText: formatRowValue(usage.cacheBytes),
      type: 'info' as const,
    },
    {
      id: 'temporary-files',
      labelKey: 'settingsDetails.storageUsage.temporaryFiles',
      valueText: formatRowValue(usage.temporaryBytes),
      type: 'info' as const,
    },
    {
      id: 'total',
      labelKey: 'settingsDetails.storageUsage.total',
      valueText: formatRowValue(usage.totalBytes),
      type: 'info' as const,
    },
  ];

  const sections = loadFailed
    ? [
        { rows },
        {
          rows: [
            {
              id: 'load-failed',
              labelKey: 'settingsDetails.storageUsage.loadFailed',
              type: 'info' as const,
            },
            {
              id: 'retry',
              labelKey: 'common.retry',
              onPress: retry,
            },
          ],
        },
      ]
    : [{ rows }];

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.storageUsage.title"
      sections={sections}
    />
  );
}
