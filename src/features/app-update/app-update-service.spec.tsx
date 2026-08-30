import {
  ANDROID_UPDATE_MANIFEST_URL,
  checkForAndroidUpdate,
  downloadAndInstallAndroidUpdate,
} from './app-update-service';

const manifest = {
  schemaVersion: 1 as const,
  version: '1.0.1',
  versionCode: 1_000_001,
  apkUrl:
    'https://github.com/CircleTeamHub/windnote-releases/releases/download/v1.0.1/windnote.apk',
  sha256: 'a'.repeat(64),
  sizeBytes: 42,
};

describe('Android app update service', () => {
  it('returns a strictly newer validated release manifest', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => manifest,
    });

    expect(ANDROID_UPDATE_MANIFEST_URL).toBe(
      'https://github.com/CircleTeamHub/windnote-releases/releases/latest/download/release.json',
    );

    await expect(
      checkForAndroidUpdate({
        platform: 'android',
        isStandalone: true,
        versionCode: 1_000_000,
        fetchImpl,
      }),
    ).resolves.toEqual(manifest);
    expect(fetchImpl).toHaveBeenCalledWith(
      ANDROID_UPDATE_MANIFEST_URL,
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns null when the installed build is already current', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...manifest,
        version: '1.0.0',
        versionCode: 1_000_000,
        apkUrl:
          'https://github.com/CircleTeamHub/windnote-releases/releases/download/v1.0.0/windnote.apk',
      }),
    });

    await expect(
      checkForAndroidUpdate({
        platform: 'android',
        isStandalone: true,
        versionCode: 1_000_000,
        fetchImpl,
      }),
    ).resolves.toBeNull();
  });

  it('does not request an APK manifest on non-Android platforms', async () => {
    const fetchImpl = jest.fn();

    await expect(
      checkForAndroidUpdate({
        platform: 'ios',
        isStandalone: true,
        versionCode: 1_000_000,
        fetchImpl,
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not offer this app APK while running inside a development client', async () => {
    const fetchImpl = jest.fn();

    await expect(
      checkForAndroidUpdate({
        platform: 'android',
        isStandalone: false,
        versionCode: 1_000_000,
        fetchImpl,
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('downloads, verifies, and opens the APK with read permission', async () => {
    const dependencies = {
      platform: 'android',
      cacheDirectory: 'file:///cache/',
      downloadAsync: jest.fn().mockResolvedValue({
        uri: 'file:///cache/windnote-update-1000001.apk',
        status: 200,
      }),
      getInfoAsync: jest.fn().mockResolvedValue({
        exists: true,
        isDirectory: false,
        size: 42,
      }),
      getContentUriAsync: jest
        .fn()
        .mockResolvedValue('content://windnote/update.apk'),
      deleteAsync: jest.fn().mockResolvedValue(undefined),
      startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
    };

    await downloadAndInstallAndroidUpdate(manifest, dependencies);

    expect(dependencies.downloadAsync).toHaveBeenCalledWith(
      manifest.apkUrl,
      'file:///cache/windnote-update-1000001.apk',
    );
    expect(dependencies.startActivityAsync).toHaveBeenCalledWith(
      'android.intent.action.VIEW',
      {
        data: 'content://windnote/update.apk',
        flags: 1,
        type: 'application/vnd.android.package-archive',
      },
    );
    expect(dependencies.deleteAsync).not.toHaveBeenCalled();
  });

  it('deletes a downloaded APK whose byte size does not match the manifest', async () => {
    const dependencies = {
      platform: 'android',
      cacheDirectory: 'file:///cache/',
      downloadAsync: jest.fn().mockResolvedValue({
        uri: 'file:///cache/windnote-update-1000001.apk',
        status: 200,
      }),
      getInfoAsync: jest.fn().mockResolvedValue({
        exists: true,
        isDirectory: false,
        size: 41,
      }),
      getContentUriAsync: jest.fn(),
      deleteAsync: jest.fn().mockResolvedValue(undefined),
      startActivityAsync: jest.fn(),
    };

    await expect(
      downloadAndInstallAndroidUpdate(manifest, dependencies),
    ).rejects.toThrow(/verification failed/i);
    expect(dependencies.deleteAsync).toHaveBeenCalledWith(
      'file:///cache/windnote-update-1000001.apk',
      { idempotent: true },
    );
    expect(dependencies.startActivityAsync).not.toHaveBeenCalled();
  });
});
