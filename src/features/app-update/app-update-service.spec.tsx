import { checkForManagedUpdate } from "./managed-update-service";
import {
  checkForAndroidUpdate,
  downloadAndInstallAndroidUpdate,
} from "./app-update-service";

jest.mock("./managed-update-service", () => ({
  checkForManagedUpdate: jest.fn(),
}));

const manifest = {
  schemaVersion: 1 as const,
  version: "1.0.1",
  versionCode: 1_000_001,
  apkUrl:
    "https://github.com/CircleTeamHub/windnote-releases/releases/download/v1.0.1/windnote.apk",
  sha256: "a".repeat(64),
  sizeBytes: 42,
};

describe("Android app update service", () => {
  it("uses the same managed decision for manual checks", async () => {
    jest
      .mocked(checkForManagedUpdate)
      .mockResolvedValue({
        platform: "android",
        mandatory: false,
        version: manifest.version,
        url: manifest.apkUrl,
        manifest,
      });
    await expect(checkForAndroidUpdate()).resolves.toEqual(manifest);
  });

  it("downloads, verifies, and opens the APK with read permission", async () => {
    const dependencies = {
      platform: "android",
      cacheDirectory: "file:///cache/",
      downloadAsync: jest.fn().mockResolvedValue({
        uri: "file:///cache/windnote-update-1000001.apk",
        status: 200,
      }),
      getInfoAsync: jest.fn().mockResolvedValue({
        exists: true,
        isDirectory: false,
        size: 42,
      }),
      getContentUriAsync: jest
        .fn()
        .mockResolvedValue("content://windnote/update.apk"),
      hashFile: jest.fn().mockResolvedValue(manifest.sha256),
      readDirectoryAsync: jest
        .fn()
        .mockResolvedValue(["windnote-update-1000000.apk", "other-cache.bin"]),
      deleteAsync: jest.fn().mockResolvedValue(undefined),
      startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
    };

    await downloadAndInstallAndroidUpdate(manifest, dependencies);

    expect(dependencies.downloadAsync).toHaveBeenCalledWith(
      manifest.apkUrl,
      "file:///cache/windnote-update-1000001.apk",
    );
    expect(dependencies.startActivityAsync).toHaveBeenCalledWith(
      "android.intent.action.VIEW",
      {
        data: "content://windnote/update.apk",
        flags: 1,
        type: "application/vnd.android.package-archive",
      },
    );
    expect(dependencies.deleteAsync).toHaveBeenNthCalledWith(
      1,
      "file:///cache/windnote-update-1000000.apk",
      { idempotent: true },
    );
    expect(dependencies.deleteAsync).toHaveBeenNthCalledWith(
      2,
      "file:///cache/windnote-update-1000001.apk",
      { idempotent: true },
    );
    expect(dependencies.deleteAsync).toHaveBeenCalledTimes(2);
  });

  it("deletes a downloaded APK whose byte size does not match the manifest", async () => {
    const dependencies = {
      platform: "android",
      cacheDirectory: "file:///cache/",
      downloadAsync: jest.fn().mockResolvedValue({
        uri: "file:///cache/windnote-update-1000001.apk",
        status: 200,
      }),
      getInfoAsync: jest.fn().mockResolvedValue({
        exists: true,
        isDirectory: false,
        size: 41,
      }),
      getContentUriAsync: jest.fn(),
      hashFile: jest.fn(),
      readDirectoryAsync: jest.fn().mockResolvedValue([]),
      deleteAsync: jest.fn().mockResolvedValue(undefined),
      startActivityAsync: jest.fn(),
    };

    await expect(
      downloadAndInstallAndroidUpdate(manifest, dependencies),
    ).rejects.toThrow(/verification failed/i);
    expect(dependencies.deleteAsync).toHaveBeenCalledWith(
      "file:///cache/windnote-update-1000001.apk",
      { idempotent: true },
    );
    expect(dependencies.startActivityAsync).not.toHaveBeenCalled();
  });

  it("deletes a same-sized APK whose SHA-256 does not match the manifest", async () => {
    const dependencies = {
      platform: "android",
      cacheDirectory: "file:///cache/",
      downloadAsync: jest.fn().mockResolvedValue({
        uri: "file:///cache/windnote-update-1000001.apk",
        status: 200,
      }),
      getInfoAsync: jest.fn().mockResolvedValue({
        exists: true,
        isDirectory: false,
        size: 42,
      }),
      getContentUriAsync: jest.fn(),
      hashFile: jest.fn().mockResolvedValue("b".repeat(64)),
      readDirectoryAsync: jest.fn().mockResolvedValue([]),
      deleteAsync: jest.fn().mockResolvedValue(undefined),
      startActivityAsync: jest.fn(),
    };

    await expect(
      downloadAndInstallAndroidUpdate(manifest, dependencies),
    ).rejects.toThrow(/verification failed/i);
    expect(dependencies.hashFile).toHaveBeenCalledWith(
      "file:///cache/windnote-update-1000001.apk",
      "sha256",
    );
    expect(dependencies.deleteAsync).toHaveBeenCalledWith(
      "file:///cache/windnote-update-1000001.apk",
      { idempotent: true },
    );
    expect(dependencies.startActivityAsync).not.toHaveBeenCalled();
  });

  it("shares one in-flight install across the startup and manual entry points", async () => {
    let finishDownload!: (result: { uri: string; status: number }) => void;
    const downloadResult = new Promise<{ uri: string; status: number }>(
      (resolve) => {
        finishDownload = resolve;
      },
    );
    const dependencies = {
      platform: "android",
      cacheDirectory: "file:///cache/",
      downloadAsync: jest.fn().mockReturnValue(downloadResult),
      getInfoAsync: jest.fn().mockResolvedValue({
        exists: true,
        isDirectory: false,
        size: 42,
      }),
      getContentUriAsync: jest
        .fn()
        .mockResolvedValue("content://windnote/update.apk"),
      hashFile: jest.fn().mockResolvedValue(manifest.sha256),
      readDirectoryAsync: jest.fn().mockResolvedValue([]),
      deleteAsync: jest.fn().mockResolvedValue(undefined),
      startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
    };

    const startupInstall = downloadAndInstallAndroidUpdate(
      manifest,
      dependencies,
    );
    const manualInstall = downloadAndInstallAndroidUpdate(
      manifest,
      dependencies,
    );
    finishDownload({
      uri: "file:///cache/windnote-update-1000001.apk",
      status: 200,
    });

    await Promise.all([startupInstall, manualInstall]);
    expect(dependencies.downloadAsync).toHaveBeenCalledTimes(1);
    expect(dependencies.hashFile).toHaveBeenCalledTimes(1);
    expect(dependencies.startActivityAsync).toHaveBeenCalledTimes(1);
  });
});
