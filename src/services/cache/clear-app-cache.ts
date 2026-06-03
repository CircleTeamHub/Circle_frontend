import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

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

// Maximum recursion depth for directory size calculation. Defends against
// symlink loops and pathological cache layouts blowing the stack.
const MAX_DIRECTORY_DEPTH = 16;

// Names within the cache root that the app must NOT touch when "Clear Cache"
// runs. These belong to the OS, system frameworks, or other native modules
// that own their own lifecycle. Matching is done on the entry's basename.
const CACHE_CLEAR_DENYLIST = new Set([
  // OpenIM SDK state (defensive — currently lives under DocumentDirectory)
  'openim',
  // Persistent stores accidentally placed under cache by some libs
  'mmkv',
  'RCTAsyncLocalStorage_V1',
  // iOS WebKit / cookie state — clearing logs the user out of webviews
  'WebKit',
  'Cookies.binarycookies',
  'com.apple.WebKit.Networking',
  // System-managed snapshots — iOS regenerates these; deleting can crash
  'Snapshots',
  'com.apple.nsurlsessiond',
]);

type NativeFS = typeof import('react-native-fs');
type NativeFSModule = NativeFS & { default?: NativeFS };
let rnfsPromise: Promise<NativeFS> | null = null;

function canUseNativeFS() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

async function loadNativeFS() {
  rnfsPromise ??= import('react-native-fs').then((module) => {
    const loaded = module as NativeFSModule;
    return loaded.default ?? loaded;
  });
  return rnfsPromise;
}

function basename(filePath: string) {
  const trimmed = filePath.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function isDenylisted(entryPath: string) {
  return CACHE_CLEAR_DENYLIST.has(basename(entryPath));
}

function normalizePath(path: string) {
  return path.replace(/^file:\/\//, '').replace(/\/+$/, '');
}

function getUniquePaths(candidatePaths: Array<string | null | undefined>) {
  const paths = candidatePaths.filter((path): path is string => Boolean(path));

  return Array.from(new Set(paths.map(normalizePath))).filter(Boolean);
}

async function getCacheDirectories() {
  if (!canUseNativeFS()) {
    return getUniquePaths([FileSystem.cacheDirectory]);
  }

  const RNFS = await loadNativeFS();
  return getUniquePaths([
    FileSystem.cacheDirectory,
    RNFS.CachesDirectoryPath,
    RNFS.TemporaryDirectoryPath,
  ]);
}

async function getPrimaryCacheDirectories() {
  if (!canUseNativeFS()) {
    return getUniquePaths([FileSystem.cacheDirectory]);
  }

  const RNFS = await loadNativeFS();
  return getUniquePaths([FileSystem.cacheDirectory, RNFS.CachesDirectoryPath]);
}

async function getTemporaryDirectories() {
  if (!canUseNativeFS()) {
    return [];
  }

  const RNFS = await loadNativeFS();
  return getUniquePaths([RNFS.TemporaryDirectoryPath]);
}

async function getOpenIMDirectory() {
  if (!canUseNativeFS()) {
    return '';
  }

  const RNFS = await loadNativeFS();
  return `${RNFS.DocumentDirectoryPath}/openim`;
}

async function getDirectorySize(
  directoryPath: string,
  depth = 0,
): Promise<number> {
  const normalizedPath = normalizePath(directoryPath);

  if (!normalizedPath || depth > MAX_DIRECTORY_DEPTH) {
    return 0;
  }

  if (!canUseNativeFS()) {
    return 0;
  }

  const RNFS = await loadNativeFS();
  const exists = await RNFS.exists(normalizedPath);
  if (!exists) {
    return 0;
  }

  const entries = (await RNFS.readDir(normalizedPath)) as CacheEntry[];
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory?.()) {
        return getDirectorySize(entry.path, depth + 1);
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

  if (!canUseNativeFS()) {
    return { clearedEntries: 0, failedEntries: 0 };
  }

  const RNFS = await loadNativeFS();
  const exists = await RNFS.exists(normalizedPath);
  if (!exists) {
    return { clearedEntries: 0, failedEntries: 0 };
  }

  const entries = await RNFS.readDir(normalizedPath);
  const safeEntries = entries.filter((entry) => !isDenylisted(entry.path));

  const results = await Promise.allSettled(
    safeEntries.map((entry) => RNFS.unlink(entry.path)),
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
  return getDirectoriesSize(await getCacheDirectories());
}

export async function getAppStorageUsage(): Promise<AppStorageUsage> {
  const [openIMDirectory, primaryCacheDirectories, temporaryDirectories] =
    await Promise.all([
      getOpenIMDirectory(),
      getPrimaryCacheDirectories(),
      getTemporaryDirectories(),
    ]);

  const [chatBytes, cacheBytes, temporaryBytes] = await Promise.all([
    getDirectoriesSize(openIMDirectory ? [openIMDirectory] : []),
    getDirectoriesSize(primaryCacheDirectories),
    getDirectoriesSize(temporaryDirectories),
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
    (await getCacheDirectories()).map((path) => clearDirectoryContents(path)),
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
