import Constants, { ExecutionEnvironment } from 'expo-constants';
import {
  cacheDirectory,
  deleteAsync as deleteFileAsync,
  downloadAsync,
  getContentUriAsync,
  getInfoAsync,
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
  isStandalone: boolean;
  versionCode: number;
  fetchImpl: typeof fetch;
}

interface AndroidInstallerDependencies {
  platform: string;
  cacheDirectory: string | null;
  downloadAsync: typeof downloadAsync;
  getInfoAsync: typeof getInfoAsync;
  getContentUriAsync: typeof getContentUriAsync;
  deleteAsync: typeof deleteFileAsync;
  startActivityAsync: typeof IntentLauncher.startActivityAsync;
}

export const ANDROID_UPDATE_MANIFEST_URL =
  DEFAULT_ANDROID_UPDATE_MANIFEST_URL;

function assertSecureManifestUrl(): void {
  const url = new URL(ANDROID_UPDATE_MANIFEST_URL);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Android update manifest URL must use HTTPS');
  }
}

export async function checkForAndroidUpdate(
  dependencies: UpdateCheckDependencies = {
    platform: Platform.OS,
    isStandalone:
      Constants.executionEnvironment === ExecutionEnvironment.Standalone,
    versionCode: Constants.platform?.android?.versionCode ?? 0,
    fetchImpl: fetch,
  },
): Promise<AndroidReleaseManifest | null> {
  if (dependencies.platform !== 'android' || !dependencies.isStandalone) {
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
    return isAndroidUpdateAvailable(dependencies.versionCode, manifest)
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

export async function downloadAndInstallAndroidUpdate(
  manifest: AndroidReleaseManifest,
  dependencies: AndroidInstallerDependencies = {
    platform: Platform.OS,
    cacheDirectory,
    downloadAsync,
    getInfoAsync,
    getContentUriAsync,
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

  const targetUri = `${dependencies.cacheDirectory}windnote-update-${manifest.versionCode}.apk`;
  let downloadedUri = targetUri;
  let installerStarted = false;

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

    const contentUri = await dependencies.getContentUriAsync(downloadedUri);
    await dependencies.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1,
      type: 'application/vnd.android.package-archive',
    });
    installerStarted = true;
  } finally {
    if (!installerStarted) {
      await removeCachedApk(downloadedUri, dependencies.deleteAsync);
    }
  }
}
