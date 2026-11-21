import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { topNotice } from '@/components/app/top-notice-store';
import { AddToHomeScreenBanner } from './AddToHomeScreenBanner';
import { AddToHomeScreenGuide } from './AddToHomeScreenGuide';

const mockInstall = {
  mode: 'guide' as 'guide' | 'prompt' | null,
  start: jest.fn(),
  guideVisible: false,
  closeGuide: jest.fn(),
};
const mockBrowser = { inApp: false };

jest.mock('../hooks/use-add-to-home-screen', () => ({ useAddToHomeScreen: () => mockInstall }));
jest.mock('../services/home-screen-install', () => ({ isAppleInAppBrowser: () => mockBrowser.inApp }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@/components/app/top-notice-store', () => ({ topNotice: { success: jest.fn() } }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/components/ui/bottom-sheet-modal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? children : null),
}));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({
    colors: {
      surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666',
      warning: '#FB8C00', primary: '#6366F1', iconAccent: '#6366F1', white: '#fff',
    },
  }),
}));

const storage = new Map<string, string>();

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://app.example/chat' } });
});

beforeEach(() => {
  jest.clearAllMocks();
  storage.clear();
  Object.assign(mockInstall, { mode: 'guide', guideVisible: false });
  mockBrowser.inApp = false;
});

describe('AddToHomeScreenBanner', () => {
  it('stays hidden where the page cannot be added (native apps, installed web app)', () => {
    mockInstall.mode = null;
    render(<AddToHomeScreenBanner />);
    expect(screen.queryByTestId('add-to-home-screen-banner')).toBeNull();
  });

  it('starts adding when the add button is tapped', () => {
    render(<AddToHomeScreenBanner />);
    expect(screen.getByText('homeScreenInstall.banner')).toBeTruthy();
    fireEvent.press(screen.getByText('homeScreenInstall.add'));
    expect(mockInstall.start).toHaveBeenCalledTimes(1);
  });

  it('stays closed once the user dismisses it, even after a reload', () => {
    const { unmount } = render(<AddToHomeScreenBanner />);
    fireEvent.press(screen.getByLabelText('homeScreenInstall.dismiss'));
    expect(screen.queryByTestId('add-to-home-screen-banner')).toBeNull();
    unmount();

    render(<AddToHomeScreenBanner />);
    expect(screen.queryByTestId('add-to-home-screen-banner')).toBeNull();
  });

  it('a dismissal still holds when Chrome offers its install prompt later', () => {
    storage.set('windnote.home-screen-banner-dismissed', '1');
    mockInstall.mode = null;
    const { rerender } = render(<AddToHomeScreenBanner />);
    mockInstall.mode = 'prompt';
    rerender(<AddToHomeScreenBanner />);
    expect(screen.queryByTestId('add-to-home-screen-banner')).toBeNull();
  });
});

describe('AddToHomeScreenGuide', () => {
  it('walks through the Safari share menu steps', () => {
    const onClose = jest.fn();
    render(<AddToHomeScreenGuide visible onClose={onClose} />);
    for (const step of ['share', 'add', 'confirm', 'open']) {
      expect(screen.getByText(`homeScreenInstall.steps.${step}.detail`)).toBeTruthy();
    }
    expect(screen.queryByText('homeScreenInstall.inAppBrowser')).toBeNull();
    fireEvent.press(screen.getByText('homeScreenInstall.done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('inside WeChat and similar apps it first sends the user to Safari with the link copied', async () => {
    mockBrowser.inApp = true;
    render(<AddToHomeScreenGuide visible onClose={jest.fn()} />);
    expect(screen.getByText('homeScreenInstall.inAppBrowser')).toBeTruthy();
    fireEvent.press(screen.getByText('homeScreenInstall.copyLink'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://app.example/chat');
    await screen.findByText('homeScreenInstall.done');
    expect(topNotice.success).toHaveBeenCalledWith('homeScreenInstall.linkCopied');
  });
});
