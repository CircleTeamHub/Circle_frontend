import * as Updates from 'expo-updates';

export type OtaUpdateResult = 'disabled' | 'latest' | 'downloaded';

export interface OtaUpdateDependencies {
  isEnabled: boolean;
  isDevelopment: boolean;
  checkForUpdateAsync: typeof Updates.checkForUpdateAsync;
  fetchUpdateAsync: typeof Updates.fetchUpdateAsync;
  reloadAsync: typeof Updates.reloadAsync;
}

const defaultDependencies: OtaUpdateDependencies = {
  isEnabled: Updates.isEnabled,
  isDevelopment: typeof __DEV__ !== 'undefined' && __DEV__,
  checkForUpdateAsync: Updates.checkForUpdateAsync,
  fetchUpdateAsync: Updates.fetchUpdateAsync,
  reloadAsync: Updates.reloadAsync,
};

export async function downloadOtaUpdate(
  dependencies: OtaUpdateDependencies = defaultDependencies,
): Promise<OtaUpdateResult> {
  if (!dependencies.isEnabled || dependencies.isDevelopment) {
    return 'disabled';
  }

  const check = await dependencies.checkForUpdateAsync();
  if (!check.isAvailable) {
    return 'latest';
  }

  const download = await dependencies.fetchUpdateAsync();
  if (!download.isNew) {
    throw new Error('OTA update download did not produce a new update');
  }
  return 'downloaded';
}

export async function reloadOtaUpdate(
  dependencies: OtaUpdateDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.reloadAsync();
}
