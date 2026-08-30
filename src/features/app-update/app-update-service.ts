import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Application from 'expo-application';
import {
  cacheDirectory,
  deleteAsync as deleteFileAsync,
  downloadAsync,
  getContentUriAsync,
  getInfoAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import {
  isAndroidUpdateAvailable,
  parseGitHubReleaseManifest,
  type AndroidReleaseManifest,
} from './app-update-manifest';

const DEFAULT_ANDROID_UPDATE_MANIFEST_URL =
  'https://github.com/CircleTeamHub/windnote-releases/releases/latest/download/release.json';
const UPDATE_CHECK_TIMEOUT_MS = 10_000;

interface UpdateCheckDependencies {
  platform: string;
  executionEnvironment: string;
  nativeBuildVersion: string | null;
  isDevelopment: boolean;
  appVariant?: unknown;
  fetchImpl: typeof fetch;
}

interface AndroidInstallerDependencies {
  platform: string;
  cacheDirectory: string | null;
  downloadAsync: typeof downloadAsync;
  getInfoAsync: typeof getInfoAsync;
  getContentUriAsync: typeof getContentUriAsync;
  hashFile: (filePath: string, algorithm: 'sha256') => Promise<string>;
  readDirectoryAsync: typeof readDirectoryAsync;
  deleteAsync: typeof deleteFileAsync;
  startActivityAsync: typeof IntentLauncher.startActivityAsync;
}

export const ANDROID_UPDATE_MANIFEST_URL =
  DEFAULT_ANDROID_UPDATE_MANIFEST_URL;

type NativeFS = typeof import('react-native-fs');
type NativeFSModule = NativeFS & { default?: NativeFS };

async function hashAndroidUpdateFile(
  filePath: string,
  algorithm: 'sha256',
): Promise<string> {
  const loaded = (await import('react-native-fs')) as NativeFSModule;
  const nativeFs = loaded.default ?? loaded;
  return nativeFs.hash(filePath, algorithm);
}

function assertSecureManifestUrl(): void {
  const url = new URL(ANDROID_UPDATE_MANIFEST_URL);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Android update manifest URL must use HTTPS');
  }
}

export async function checkForAndroidUpdate(
  dependencies: UpdateCheckDependencies = {
    platform: Platform.OS,
    executionEnvironment: Constants.executionEnvironment,
    nativeBuildVersion: Application.nativeBuildVersion,
    isDevelopment: typeof __DEV__ !== 'undefined' && __DEV__,
    appVariant: Constants.expoConfig?.extra?.appVariant,
    fetchImpl: fetch,
  },
): Promise<AndroidReleaseManifest | null> {
  if (
    dependencies.platform !== 'android' ||
    dependencies.isDevelopment ||
    dependencies.appVariant === 'preprod' ||
    dependencies.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    return null;
  }

  assertSecureManifestUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  try {
    const response = await dependencies.fetchImpl(ANDROID_UPDATE_MANIFEST_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Android update check failed with status ${response.status}`);
    }

    const manifest = parseGitHubReleaseManifest(await response.json());
    const versionCode = Number(dependencies.nativeBuildVersion ?? '');
    return isAndroidUpdateAvailable(versionCode, manifest)
      ? manifest
      : null;
  } finally {
    clearTimeout(timer);
  }
}

async function removeCachedApk(
  uri: string,
  deleteAsync: typeof deleteFileAsync,
): Promise<void> {
  await deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

async function removeStaleCachedApks(
  directory: string,
  readDirectory: typeof readDirectoryAsync,
  deleteAsync: typeof deleteFileAsync,
): Promise<void> {
  const entries = await readDirectory(directory).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => /^windnote-update-\d+\.apk$/.test(name))
      .map((name) => removeCachedApk(`${directory}${name}`, deleteAsync)),
  );
}

let activeAndroidInstall: Promise<void> | null = null;

async function performAndroidUpdateInstall(
  manifest: AndroidReleaseManifest,
  dependencies: AndroidInstallerDependencies,
  resolvedCacheDirectory: string,
): Promise<void> {
  await removeStaleCachedApks(
    resolvedCacheDirectory,
    dependencies.readDirectoryAsync,
    dependencies.deleteAsync,
  );
  const targetUri = `${resolvedCacheDirectory}windnote-update-${manifest.versionCode}.apk`;
  let downloadedUri = targetUri;

  try {
    const download = await dependencies.downloadAsync(manifest.apkUrl, targetUri);
    downloadedUri = download.uri;
    if (download.status < 200 || download.status >= 300) {
      throw new Error(`Android update download failed with status ${download.status}`);
    }

    const info = await dependencies.getInfoAsync(downloadedUri);
    if (!info.exists || info.isDirectory || info.size !== manifest.sizeBytes) {
      throw new Error('Android update verification failed');
    }
    const digest = await dependencies.hashFile(downloadedUri, 'sha256');
    if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error('Android update verification failed');
    }

    const contentUri = await dependencies.getContentUriAsync(downloadedUri);
    await dependencies.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1,
      type: 'application/vnd.android.package-archive',
    });
  } finally {
    await removeCachedApk(downloadedUri, dependencies.deleteAsync);
  }
}

export async function downloadAndInstallAndroidUpdate(
  manifest: AndroidReleaseManifest,
  dependencies: AndroidInstallerDependencies = {
    platform: Platform.OS,
    cacheDirectory,
    downloadAsync,
    getInfoAsync,
    getContentUriAsync,
    hashFile: hashAndroidUpdateFile,
    readDirectoryAsync,
    deleteAsync: deleteFileAsync,
    startActivityAsync: IntentLauncher.startActivityAsync,
  },
): Promise<void> {
  if (dependencies.platform !== 'android') {
    throw new Error('APK installation is only available on Android');
  }
  if (!dependencies.cacheDirectory) {
    throw new Error('Android update cache is unavailable');
  }
  if (activeAndroidInstall) {
    return activeAndroidInstall;
  }

  const install = performAndroidUpdateInstall(
    manifest,
    dependencies,
    dependencies.cacheDirectory,
  );
  activeAndroidInstall = install;
  try {
    await install;
  } finally {
    if (activeAndroidInstall === install) {
      activeAndroidInstall = null;
    }
  }
}
