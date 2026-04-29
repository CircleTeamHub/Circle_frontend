import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { clearAllLocalMessages } from '@/im/client';
import {
  clearAppCache,
  formatCacheSize,
  getAppCacheSize,
} from '@/services/cache/clear-app-cache';

export interface UseStorageActionsResult {
  cacheSizeLabel: string;
  clearingCache: boolean;
  clearingChats: boolean;
  busy: boolean;
  confirmClearCache: () => void;
  confirmClearChats: () => void;
}

export function useStorageActions(): UseStorageActionsResult {
  const { t } = useTranslation();
  const mountedRef = useRef(true);
  const clearingCacheRef = useRef(false);
  const clearingChatsRef = useRef(false);
  const [cacheSizeLabel, setCacheSizeLabel] = useState(
    t('appSettings.cacheCalculating'),
  );
  const [clearingCache, setClearingCache] = useState(false);
  const [clearingChats, setClearingChats] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshCacheSize = useCallback(() => {
    getAppCacheSize()
      .then((size) => {
        if (!mountedRef.current) return;
        setCacheSizeLabel(formatCacheSize(size));
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setCacheSizeLabel(formatCacheSize(0));
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCacheSize();
    }, [refreshCacheSize]),
  );

  const confirmClearCache = useCallback(() => {
    if (clearingCacheRef.current || clearingChatsRef.current) return;

    Alert.alert(
      t('settingsDetails.storage.clearCache'),
      t('settingsDetails.storage.clearCacheWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settingsDetails.storage.clearCacheAction'),
          style: 'destructive',
          onPress: async () => {
            if (clearingCacheRef.current) return;
            clearingCacheRef.current = true;
            if (mountedRef.current) setClearingCache(true);

            try {
              const result = await clearAppCache();
              if (!mountedRef.current) return;
              refreshCacheSize();
              Alert.alert(
                t('settingsDetails.storage.cacheCleared'),
                result.failedEntries > 0
                  ? t('settingsDetails.storage.cachePartiallyCleared')
                  : t('settingsDetails.storage.cacheClearedMessage'),
              );
            } catch {
              if (!mountedRef.current) return;
              Alert.alert(
                t('settingsDetails.storage.clearCacheFailed'),
                t('settingsDetails.storage.clearCacheFailedMessage'),
              );
            } finally {
              clearingCacheRef.current = false;
              if (mountedRef.current) setClearingCache(false);
            }
          },
        },
      ],
    );
  }, [t, refreshCacheSize]);

  const confirmClearChats = useCallback(() => {
    if (clearingCacheRef.current || clearingChatsRef.current) return;

    Alert.alert(
      t('settingsDetails.storage.clearAllChats'),
      t('settingsDetails.storage.clearAllChatsWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settingsDetails.storage.clearAllChatsAction'),
          style: 'destructive',
          onPress: async () => {
            if (clearingChatsRef.current) return;
            clearingChatsRef.current = true;
            if (mountedRef.current) setClearingChats(true);

            try {
              await clearAllLocalMessages();
              if (!mountedRef.current) return;
              Alert.alert(
                t('settingsDetails.storage.clearAllChatsDone'),
                t('settingsDetails.storage.clearAllChatsDoneMessage'),
              );
            } catch {
              if (!mountedRef.current) return;
              Alert.alert(
                t('settingsDetails.storage.clearAllChatsFailed'),
                t('settingsDetails.storage.clearAllChatsFailedMessage'),
              );
            } finally {
              clearingChatsRef.current = false;
              if (mountedRef.current) setClearingChats(false);
            }
          },
        },
      ],
    );
  }, [t]);

  return {
    cacheSizeLabel,
    clearingCache,
    clearingChats,
    busy: clearingCache || clearingChats,
    confirmClearCache,
    confirmClearChats,
  };
}
