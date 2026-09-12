import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import FriendTagsScreen from './FriendTagsScreen';
import { createFriendTag, fetchFriendTags, fetchFriendsByTag } from '@/services/api/friends';

const mockTranslate = (key: string) => key;
let mockFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallback = callback;
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('@/theme', () => ({
  Radius: { full: 999, lg: 12, xl: 18 },
  Spacing: { md: 8, lg: 16, xl: 24 },
  Typography: { h3: {}, body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: {
    background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111',
    textSecondary: '#666', primary: '#00f', white: '#fff',
  } }),
}));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/menu-row', () => ({ MenuRow: () => null }));
jest.mock('@/components/ui/nav-header', () => ({
  NavHeader: ({ rightSlot }: { rightSlot?: React.ReactNode }) => rightSlot ?? null,
}));
jest.mock('@/services/api/friends', () => ({
  fetchFriendTags: jest.fn(),
  fetchFriendsByTag: jest.fn(),
  createFriendTag: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

test('two immediate create presses send only one non-idempotent request', async () => {
  jest.mocked(fetchFriendTags).mockResolvedValue([]);
  jest.mocked(createFriendTag).mockReturnValue(new Promise(() => {}));
  render(<FriendTagsScreen />);
  await screen.findByText('contacts.tagsScreen.empty');

  fireEvent.press(screen.getByLabelText('contacts.tagsScreen.addTag'));
  fireEvent.changeText(
    screen.getByPlaceholderText('contacts.tagsScreen.tagNamePlaceholder'),
    '同事',
  );
  const create = screen.getByText('common.create');
  fireEvent.press(create);
  fireEvent.press(create);

  expect(createFriendTag).toHaveBeenCalledTimes(1);
  expect(createFriendTag).toHaveBeenCalledWith('同事');
});

test('refreshes tag counts when returning from a tag detail screen', async () => {
  jest.mocked(fetchFriendTags).mockResolvedValue([
    { id: 'tag-1', ownerID: 'owner-1', name: '同事', color: null },
  ]);
  jest.mocked(fetchFriendsByTag)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);

  render(<FriendTagsScreen />);
  await waitFor(() => expect(fetchFriendsByTag).toHaveBeenCalledTimes(1));

  await act(async () => {
    mockFocusCallback?.();
    await Promise.resolve();
  });

  await waitFor(() => expect(fetchFriendsByTag).toHaveBeenCalledTimes(2));
});
