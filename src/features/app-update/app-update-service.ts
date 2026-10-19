import { checkForManagedUpdate } from './managed-update-service';
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
  type AndroidReleaseManifest,
} from './app-update-manifest';

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

/** Manual checks use exactly the same rollout and withdrawal decisions as startup. */
export async function checkForAndroidUpdate():Promise<AndroidReleaseManifest|null> {
  return (await checkForManagedUpdate())?.manifest??null;
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
