import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import QuickChatScreen from './QuickChatScreen';

let mockParams: Record<string, string | undefined> = {};
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockChat = jest.fn();
const mockKeyboardAvoidance = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (route: unknown) => mockPush(route), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children, enabled }: { children: React.ReactNode; enabled?: boolean }) => {
    mockKeyboardAvoidance(enabled);
    return children;
  },
}));
jest.mock('@/theme', () => ({
  Radius: { xxl: 24, full: 99 },
  useTheme: () => ({ colors: { overlay: 'rgba(0,0,0,0.4)', background: '#fff', surfaceBorder: '#ddd' } }),
}));
jest.mock('@/features/chat/screens/ChatDetailScreen', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  function MockChatDetailScreen(props: {
    embedded: unknown;
    sheet: { onClose: () => void; onExpand: () => void; onPanelOpenChange: (open: boolean) => void };
  }) {
      mockChat(props);
      const { useChatRouter } = jest.requireActual('@/features/chat/chat-detail/hooks/use-chat-router');
      const chatRouter = useChatRouter();
      return (
        <>
          <Pressable onPress={props.sheet.onClose}><Text>chat.close</Text></Pressable>
          <Pressable onPress={props.sheet.onExpand}><Text>chat.expand</Text></Pressable>
          <Pressable onPress={() => chatRouter.push('/(tabs)/messages/user/peer-1')}><Text>chat.openProfile</Text></Pressable>
          <Pressable onPress={() => chatRouter.pushOverChat('share-picker', { type: 'note' })}><Text>chat.openPicker</Text></Pressable>
          <Pressable onPress={() => props.sheet.onPanelOpenChange(true)}><Text>chat.openPanel</Text></Pressable>
          <Pressable onPress={() => props.sheet.onPanelOpenChange(false)}><Text>chat.closePanel</Text></Pressable>
        </>
      );
  }
  return { __esModule: true, default: MockChatDetailScreen };
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

test('leaving the sheet closes it before navigating so no second tab stack is pushed', () => {
  render(<QuickChatScreen />);
  fireEvent.press(screen.getByText('chat.openProfile'));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/messages/user/peer-1');
  expect(mockBack.mock.invocationCallOrder[0]).toBeLessThan(mockPush.mock.invocationCallOrder[0]);
});

// 回归:以前这里先展开成完整聊天页再压选择页,用户在别的 tab 时完整聊天页压不进去,
// 选完直接落到消息列表。现在选择页盖在半屏上打开,半屏不关、不展开。
test('pages that return to the chat open over the sheet without closing or expanding it', () => {
  render(<QuickChatScreen />);
  fireEvent.press(screen.getByText('chat.openPicker'));
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/chat-sheet/share-picker',
    params: { type: 'note' },
  });
});

// 表情 / 「+」面板顶替键盘:开着时半屏不再给键盘留白,关上后恢复。
test('the sheet stops avoiding the keyboard while a composer panel replaces it', () => {
  render(<QuickChatScreen />);
  expect(mockKeyboardAvoidance).toHaveBeenLastCalledWith(true);
  fireEvent.press(screen.getByText('chat.openPanel'));
  expect(mockKeyboardAvoidance).toHaveBeenLastCalledWith(false);
  fireEvent.press(screen.getByText('chat.closePanel'));
  expect(mockKeyboardAvoidance).toHaveBeenLastCalledWith(true);
});
