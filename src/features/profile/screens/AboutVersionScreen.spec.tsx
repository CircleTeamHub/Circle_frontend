import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AboutVersionScreen from './AboutVersionScreen';
import { reportHandledFailure } from '@/observability/report-failure';
import { checkForManagedUpdate } from '@/features/app-update/managed-update-service';
import {
  downloadOtaUpdate,
  reloadOtaUpdate,
} from '@/features/app-update/ota-update-service';
import { stopAutomaticOtaFailureWatch } from '@/features/app-update/ota-health';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.4.0' } },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/theme', () => ({
  Radius: { lg: 16 },
  Spacing: { sm: 8, lg: 24 },
  Typography: { body: {} },
  useTheme: () => ({
    colors: {
      primary: '#6200ee',
      white: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
    },
  }),
}));

// 只测这个页面自己的按钮与失败分支;文章外壳(导航头、正文)与此无关。
jest.mock('@/features/profile/screens/about-article-screen', () => ({
  AboutArticleScreen: ({ footer }: { footer: React.ReactNode }) => footer,
}));

jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('@/features/app-update/managed-update-service', () => ({
  checkForManagedUpdate: jest.fn(),
}));
jest.mock('@/features/app-update/app-update-service', () => ({
  checkForAndroidUpdate: jest.fn(),
  downloadAndInstallAndroidUpdate: jest.fn(),
}));
jest.mock('@/features/app-update/ota-update-service', () => ({
  downloadOtaUpdate: jest.fn(),
  reloadOtaUpdate: jest.fn(),
}));
jest.mock('@/features/app-update/ota-health', () => ({
  stopAutomaticOtaFailureWatch: jest.fn(),
}));

const mockReport = jest.mocked(reportHandledFailure);
const mockDownloadOta = jest.mocked(downloadOtaUpdate);
const mockReloadOta = jest.mocked(reloadOtaUpdate);
const mockCheckManaged = jest.mocked(checkForManagedUpdate);
const mockStopWatch = jest.mocked(stopAutomaticOtaFailureWatch);

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('AboutVersionScreen update failures', () => {
  it('reports a failed manual OTA check instead of swallowing it', async () => {
    const failure = new Error('manifest request failed');
    mockDownloadOta.mockRejectedValue(failure);
    render(<AboutVersionScreen />);

    fireEvent.press(screen.getByLabelText('appUpdate.checkCodeUpdates'));

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith('otaUpdate', 'manualCheck', failure),
    );
    // 用户仍只看到本地化的失败文案,原始错误不上屏。
    expect(alertSpy).toHaveBeenCalledWith(
      'appUpdate.codeUpdateFailedTitle',
      'appUpdate.codeUpdateFailedMessage',
    );
    // 手动检查接管了 expo-updates 状态机,之后的状态机错误归这次手动检查,
    // 不能再被自动检查的监听报成 autoCheck。
    expect(mockStopWatch).toHaveBeenCalled();
    expect(mockStopWatch.mock.invocationCallOrder[0]).toBeLessThan(
      mockDownloadOta.mock.invocationCallOrder[0],
    );
  });

  it('reports a failed reload into the downloaded OTA update', async () => {
    mockDownloadOta.mockResolvedValue('downloaded');
    const failure = new Error('reload failed');
    mockReloadOta.mockRejectedValue(failure);
    render(<AboutVersionScreen />);

    fireEvent.press(screen.getByLabelText('appUpdate.checkCodeUpdates'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const buttons = alertSpy.mock.calls[0][2] as AlertButton[];
    buttons[1].onPress?.();

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith('otaUpdate', 'reload', failure),
    );
  });

  it('reports a failed manual app-version check', async () => {
    const failure = new Error('manifest unavailable');
    mockCheckManaged.mockRejectedValue(failure);
    render(<AboutVersionScreen />);

    fireEvent.press(screen.getByLabelText('appUpdate.checkNow'));

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith('appUpdate', 'manualCheck', failure),
    );
    expect(alertSpy).toHaveBeenCalledWith(
      'appUpdate.checkFailedTitle',
      'appUpdate.checkFailedMessage',
    );
  });
});
