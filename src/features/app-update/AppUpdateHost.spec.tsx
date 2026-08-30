import { Alert } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppUpdateHost } from './AppUpdateHost';
import {
  checkForAndroidUpdate,
  downloadAndInstallAndroidUpdate,
} from './app-update-service';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

jest.mock('./app-update-service', () => ({
  checkForAndroidUpdate: jest.fn(),
  downloadAndInstallAndroidUpdate: jest.fn(),
}));

const mockCheckForAndroidUpdate = jest.mocked(checkForAndroidUpdate);
const mockDownloadAndInstallAndroidUpdate = jest.mocked(
  downloadAndInstallAndroidUpdate,
);

describe('AppUpdateHost', () => {
  it('checks once at startup and starts the installer after confirmation', async () => {
    const manifest = {
      schemaVersion: 1 as const,
      version: '1.0.1',
      versionCode: 1_000_001,
      apkUrl: 'https://downloads.example.com/windnote.apk',
      sha256: 'a'.repeat(64),
      sizeBytes: 42,
    };
    mockCheckForAndroidUpdate.mockResolvedValue(manifest);
    mockDownloadAndInstallAndroidUpdate.mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    render(<AppUpdateHost />);

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    const buttons = alert.mock.calls[0][2];
    const updateButton = buttons?.find((button) => button.onPress);
    expect(updateButton).toBeDefined();

    await act(async () => {
      await updateButton?.onPress?.();
    });
    expect(mockDownloadAndInstallAndroidUpdate).toHaveBeenCalledWith(manifest);
  });
});
