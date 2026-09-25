import {
  downloadOtaUpdate,
  reloadOtaUpdate,
  type OtaUpdateDependencies,
} from './ota-update-service';

function dependencies(
  overrides: Partial<OtaUpdateDependencies> = {},
): OtaUpdateDependencies {
  return {
    isEnabled: true,
    isDevelopment: false,
    checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }),
    fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: true }),
    reloadAsync: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('OTA update service', () => {
  it('does not call the update API in development or when disabled', async () => {
    const checkForUpdateAsync = jest.fn();

    await expect(
      downloadOtaUpdate(
        dependencies({ isDevelopment: true, checkForUpdateAsync }),
      ),
    ).resolves.toBe('disabled');
    expect(checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('reports the latest state without downloading when no update exists', async () => {
    const fetchUpdateAsync = jest.fn();

    await expect(
      downloadOtaUpdate(
        dependencies({
          checkForUpdateAsync: jest
            .fn()
            .mockResolvedValue({ isAvailable: false }),
          fetchUpdateAsync,
        }),
      ),
    ).resolves.toBe('latest');
    expect(fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it('downloads an available update and exposes an explicit reload action', async () => {
    const fetchUpdateAsync = jest.fn().mockResolvedValue({ isNew: true });
    const reloadAsync = jest.fn().mockResolvedValue(undefined);
    const deps = dependencies({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }),
      fetchUpdateAsync,
      reloadAsync,
    });

    await expect(downloadOtaUpdate(deps)).resolves.toBe('downloaded');
    await reloadOtaUpdate(deps);
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('does not report a failed download as the latest version', async () => {
    await expect(
      downloadOtaUpdate(
        dependencies({
          checkForUpdateAsync: jest
            .fn()
            .mockResolvedValue({ isAvailable: true }),
          fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: false }),
        }),
      ),
    ).rejects.toThrow('did not produce a new update');
  });
});
