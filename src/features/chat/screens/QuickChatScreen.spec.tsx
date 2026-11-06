import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import QuickChatScreen from './QuickChatScreen';

let mockParams: Record<string, string | undefined> = {};
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockChat = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (route: unknown) => mockPush(route), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/theme', () => ({
  Radius: { xxl: 24, full: 99 },
  useTheme: () => ({ colors: { overlay: 'rgba(0,0,0,0.4)', background: '#fff', surfaceBorder: '#ddd' } }),
}));
jest.mock('@/features/chat/screens/ChatDetailScreen', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: { embedded: unknown; sheet: { onClose: () => void; onExpand: () => void } }) => {
      mockChat(props);
      return (
        <>
          <Pressable onPress={props.sheet.onClose}><Text>chat.close</Text></Pressable>
          <Pressable onPress={props.sheet.onExpand}><Text>chat.expand</Text></Pressable>
        </>
      );
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { conversationID: 'conv-1', sourceID: 'peer-1', title: '小王', conversationType: 'private', searchedMsgID: 'm9' };
});

test('renders the chat in sheet mode for the banner conversation', () => {
  render(<QuickChatScreen />);
  expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({
    embedded: expect.objectContaining({ conversationID: 'conv-1', sourceID: 'peer-1', title: '小王', searchedMsgID: 'm9' }),
    sheet: expect.objectContaining({ onClose: expect.any(Function), onExpand: expect.any(Function) }),
  }));
});

test('tapping the dimmed area or the close button closes the sheet', () => {
  render(<QuickChatScreen />);
  fireEvent.press(screen.getByLabelText('common.close'));
  fireEvent.press(screen.getByText('chat.close'));
  expect(mockBack).toHaveBeenCalledTimes(2);
  expect(mockPush).not.toHaveBeenCalled();
});

test('expand closes the sheet and opens the full chat page', () => {
  render(<QuickChatScreen />);
  fireEvent.press(screen.getByText('chat.expand'));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(tabs)/messages/chat-detail',
    params: expect.objectContaining({ conversationID: 'conv-1', sourceID: 'peer-1', title: '小王' }),
  });
});

test('nothing renders without a conversation id', () => {
  mockParams = {};
  render(<QuickChatScreen />);
  expect(mockChat).not.toHaveBeenCalled();
});
