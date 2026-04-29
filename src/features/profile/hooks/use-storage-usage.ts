import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  type AppStorageUsage,
  getAppStorageUsage,
} from '@/services/cache/clear-app-cache';

const EMPTY_USAGE: AppStorageUsage = {
  chatBytes: 0,
  cacheBytes: 0,
  temporaryBytes: 0,
  totalBytes: 0,
};

export interface UseStorageUsageResult {
  usage: AppStorageUsage;
  loading: boolean;
  loadFailed: boolean;
  retry: () => void;
}

export function useStorageUsage(): UseStorageUsageResult {
  const mountedRef = useRef(true);
  const [usage, setUsage] = useState<AppStorageUsage>(EMPTY_USAGE);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (!mountedRef.current) return;
    setLoading(true);
    setLoadFailed(false);

    getAppStorageUsage()
      .then((next) => {
        if (!mountedRef.current) return;
        setUsage(next);
        setLoading(false);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setUsage(EMPTY_USAGE);
        setLoadFailed(true);
        setLoading(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { usage, loading, loadFailed, retry: load };
}
