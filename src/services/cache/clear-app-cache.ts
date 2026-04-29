import * as FileSystem from 'expo-file-system/legacy';
import RNFS from 'react-native-fs';

export interface ClearAppCacheResult {
  clearedEntries: number;
  failedEntries: number;
}

export interface AppStorageUsage {
  chatBytes: number;
  cacheBytes: number;
  temporaryBytes: number;
  totalBytes: number;
}

type CacheEntry = {
  path: string;
  size?: number;
  isDirectory?: () => boolean;
};

function normalizePath(path: string) {
  return path.replace(/^file:\/\//, '').replace(/\/+$/, '');
}

function getUniquePaths(candidatePaths: Array<string | null | undefined>) {
  const paths = candidatePaths.filter((path): path is string => Boolean(path));

  return Array.from(new Set(paths.map(normalizePath))).filter(Boolean);
}

function getCacheDirectories() {
  return getUniquePaths([
    FileSystem.cacheDirectory,
    RNFS.CachesDirectoryPath,
    RNFS.TemporaryDirectoryPath,
  ]);
}

function getPrimaryCacheDirectories() {
  return getUniquePaths([FileSystem.cacheDirectory, RNFS.CachesDirectoryPath]);
}

function getTemporaryDirectories() {
  return getUniquePaths([RNFS.TemporaryDirectoryPath]);
}

function getOpenIMDirectory() {
  return `${RNFS.DocumentDirectoryPath}/openim`;
}

async function getDirectorySize(directoryPath: string): Promise<number> {
  const normalizedPath = normalizePath(directoryPath);

  if (!normalizedPath) {
    return 0;
  }

  const exists = await RNFS.exists(normalizedPath);
  if (!exists) {
    return 0;
  }

  const entries = (await RNFS.readDir(normalizedPath)) as CacheEntry[];
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory?.()) {
        return getDirectorySize(entry.path);
      }

      return entry.size ?? 0;
    }),
  );

  return sizes.reduce((total, size) => total + size, 0);
}

async function getDirectoriesSize(paths: string[]) {
  const results = await Promise.allSettled(
    paths.map((path) => getDirectorySize(path)),
  );

  return results.reduce(
    (total, result) => total + (result.status === 'fulfilled' ? result.value : 0),
    0,
  );
}

async function clearDirectoryContents(directoryPath: string) {
  const normalizedPath = normalizePath(directoryPath);

  if (!normalizedPath) {
    return { clearedEntries: 0, failedEntries: 0 };
  }

  const exists = await RNFS.exists(normalizedPath);
  if (!exists) {
    return { clearedEntries: 0, failedEntries: 0 };
  }

  const entries = await RNFS.readDir(normalizedPath);
  const results = await Promise.allSettled(
    entries.map((entry) => RNFS.unlink(entry.path)),
  );

  return results.reduce(
    (summary, result) => ({
      clearedEntries:
        summary.clearedEntries + (result.status === 'fulfilled' ? 1 : 0),
      failedEntries:
        summary.failedEntries + (result.status === 'rejected' ? 1 : 0),
    }),
    { clearedEntries: 0, failedEntries: 0 },
  );
}

export async function getAppCacheSize(): Promise<number> {
  return getDirectoriesSize(getCacheDirectories());
}

export async function getAppStorageUsage(): Promise<AppStorageUsage> {
  const [chatBytes, cacheBytes, temporaryBytes] = await Promise.all([
    getDirectoriesSize([getOpenIMDirectory()]),
    getDirectoriesSize(getPrimaryCacheDirectories()),
    getDirectoriesSize(getTemporaryDirectories()),
  ]);

  return {
    chatBytes,
    cacheBytes,
    temporaryBytes,
    totalBytes: chatBytes + cacheBytes + temporaryBytes,
  };
}

export function formatCacheSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  const formatted =
    value >= 10 || unitIndex === 0
      ? Math.round(value).toString()
      : value.toFixed(1).replace(/\.0$/, '');

  return `${formatted} ${units[unitIndex]}`;
}

export async function clearAppCache(): Promise<ClearAppCacheResult> {
  const results = await Promise.allSettled(
    getCacheDirectories().map((path) => clearDirectoryContents(path)),
  );

  return results.reduce(
    (summary, result) => {
      if (result.status === 'rejected') {
        return {
          clearedEntries: summary.clearedEntries,
          failedEntries: summary.failedEntries + 1,
        };
      }

      return {
        clearedEntries: summary.clearedEntries + result.value.clearedEntries,
        failedEntries: summary.failedEntries + result.value.failedEntries,
      };
    },
    { clearedEntries: 0, failedEntries: 0 },
  );
}
