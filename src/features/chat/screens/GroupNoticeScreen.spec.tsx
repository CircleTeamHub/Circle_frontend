import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import GroupNoticeScreen from './GroupNoticeScreen';
import { useChatStore } from '@/chat-core/store';
import type { ChatConversationDto } from '@/chat-core/protocol';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ conversationID: 'group-1' }),
  useSegments: () => ['(tabs)', 'explore', 'group-notice'],
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  // The chat store pulls in @/i18n, which registers this plugin.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }),
}));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
// Only the header's right slot matters here; the back button has its own tests.
jest.mock('@/components/ui/nav-header', () => ({
  NavHeader: ({ rightSlot }: { rightSlot?: React.ReactNode }) => rightSlot ?? null,
}));

function group(overrides: Partial<ChatConversationDto> = {}): ChatConversationDto {
  return {
    id: 'group-1',
    type: 'GROUP',
    circleId: 'circle-9',
    name: '周末爬山群',
    notice: '周六早上八点集合\n记得带水',
    noticePinned: true,
    myRole: 'MEMBER',
    ...overrides,
  } as ChatConversationDto;
}

beforeEach(() => {
  jest.mocked(router.push).mockClear();
  useChatStore.setState({ conversations: [] });
});

test('members read the full notice and cannot edit it', () => {
  useChatStore.setState({ conversations: [group()] });
  render(<GroupNoticeScreen />);
  expect(screen.getByText('周六早上八点集合\n记得带水')).toBeTruthy();
  expect(screen.getByText('周末爬山群')).toBeTruthy();
  expect(screen.queryByTestId('group-notice-edit')).toBeNull();
});

test('managers edit from the detail page in the same stack', () => {
  useChatStore.setState({ conversations: [group({ myRole: 'ADMIN' })] });
  render(<GroupNoticeScreen />);
  fireEvent.press(screen.getByTestId('group-notice-edit'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/explore/edit-group-notice',
    params: {
      groupID: 'circle-9',
      conversationID: 'group-1',
      groupTitle: '周末爬山群',
      notice: '周六早上八点集合\n记得带水',
      noticePinned: 'true',
    },
  });
});

test('an edit saved on the edit page shows up here without reopening', () => {
  useChatStore.setState({ conversations: [group()] });
  render(<GroupNoticeScreen />);
  React.act(() => useChatStore.setState({ conversations: [group({ notice: '改到九点' })] }));
  expect(screen.getByText('改到九点')).toBeTruthy();
});

test('an empty notice says so instead of showing a blank card', () => {
  useChatStore.setState({ conversations: [group({ notice: '  ' })] });
  render(<GroupNoticeScreen />);
  expect(screen.getByText('chat.noGroupNotice')).toBeTruthy();
});
