import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import { CampaignAdBanner } from './campaign-ad-banner';

let mockFocused = true;
let appStateListener: ((state: string) => void) | null = null;

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      const focused = mockFocused;
      ReactModule.useEffect(() => {
        if (focused) return callback();
      }, [callback, focused]);
    },
  };
});

jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    useAuthStore: create(() => ({ sessionEpoch: 1, isAuthenticated: true })),
  };
});
jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));
jest.mock('@/i18n', () => ({ t: (key: string) => key }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme', () => ({
  Spacing: { sm: 8, md: 16 },
  Typography: { caption: {}, body: {} },
  useTheme: () => ({ colors: { surface: '#fff', text: '#111', textSecondary: '#666' } }),
}));

const mockApiClient = jest.mocked(apiClient);
const now = Date.parse('2026-09-30T12:00:00Z');
const advertisement = {
  id: 'campaign-1',
  title: 'Active campaign',
  imageUrl: 'https://cdn.circle.app/banner.png',
  targetUrl: 'https://circle.app/campaign',
  startsAt: new Date(now - 60_000).toISOString(),
  endsAt: new Date(now + 90_000).toISOString(),
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  jest.clearAllMocks();
  mockApiClient.mockReset();
  mockFocused = true;
  AppState.currentState = 'active';
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: string) => void;
    return { remove: jest.fn() };
  });
  useAuthStore.setState({ sessionEpoch: 1, isAuthenticated: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('a failed poll preserves the last successful ads until their scheduled expiry', async () => {
  mockApiClient.mockResolvedValueOnce([advertisement]).mockRejectedValue(new Error('offline'));
  render(<CampaignAdBanner />);
  await act(async () => {});
  expect(screen.getByText(advertisement.title)).toBeTruthy();

  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(mockApiClient).toHaveBeenCalledTimes(2);
  expect(screen.getByText(advertisement.title)).toBeTruthy();

  await act(async () => { jest.advanceTimersByTime(30_000); });
  expect(screen.queryByText(advertisement.title)).toBeNull();
});

test('a successful empty refresh removes the previous ads', async () => {
  mockApiClient.mockResolvedValueOnce([advertisement]).mockResolvedValueOnce([]);
  render(<CampaignAdBanner />);
  await act(async () => {});
  expect(screen.getByText(advertisement.title)).toBeTruthy();

  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(screen.queryByText(advertisement.title)).toBeNull();
});

test('returning to the foreground keeps active ads when refresh fails', async () => {
  mockApiClient.mockResolvedValueOnce([advertisement]).mockRejectedValueOnce(new Error('offline'));
  render(<CampaignAdBanner />);
  await act(async () => {});
  expect(screen.getByText(advertisement.title)).toBeTruthy();

  await act(async () => { appStateListener?.('active'); });

  expect(mockApiClient).toHaveBeenCalledTimes(2);
  expect(screen.getByText(advertisement.title)).toBeTruthy();
});

test('a session change clears cached ads even if the new session fetch fails', async () => {
  mockApiClient.mockResolvedValueOnce([advertisement]).mockRejectedValue(new Error('offline'));
  render(<CampaignAdBanner />);
  await act(async () => {});
  expect(screen.getByText(advertisement.title)).toBeTruthy();

  await act(async () => { useAuthStore.setState({ sessionEpoch: 2 }); });
  expect(mockApiClient).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(advertisement.title)).toBeNull();
});

test('losing focus clears cached ads and refocusing does not restore them after a failed fetch', async () => {
  mockApiClient.mockResolvedValueOnce([advertisement]).mockRejectedValue(new Error('offline'));
  const view = render(<CampaignAdBanner />);
  await act(async () => {});
  expect(screen.getByText(advertisement.title)).toBeTruthy();

  mockFocused = false;
  view.rerender(<CampaignAdBanner />);
  expect(screen.queryByText(advertisement.title)).toBeNull();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(mockApiClient).toHaveBeenCalledTimes(1);

  mockFocused = true;
  view.rerender(<CampaignAdBanner />);
  await act(async () => {});
  expect(mockApiClient).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(advertisement.title)).toBeNull();
});

test('an initial failed fetch stays empty and a later successful poll displays ads', async () => {
  mockApiClient.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([advertisement]);
  render(<CampaignAdBanner />);
  await act(async () => {});
  expect(screen.queryByText(advertisement.title)).toBeNull();

  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(screen.getByText(advertisement.title)).toBeTruthy();
});
