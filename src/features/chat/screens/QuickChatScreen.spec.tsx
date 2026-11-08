import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, PanResponder, StyleSheet } from 'react-native';
import { darkColors, lightColors } from '@/theme/colors';
import QuickChatScreen from './QuickChatScreen';

let mockParams: Record<string, string | undefined> = {};
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockChat = jest.fn();
const mockKeyboardAvoidance = jest.fn();
let mockThemeColors: Record<string, string> = { overlay: 'rgba(0,0,0,0.4)', background: '#fff', surfaceBorder: '#ddd', textSecondary: '#666' };

type Gesture = { dx: number; dy: number; vy: number; y0: number; moveY: number };
type DragHandlers = {
  onMoveShouldSetPanResponderCapture: (event: unknown, gesture: Gesture) => boolean;
  onPanResponderMove: (event: unknown, gesture: Gesture) => void;
  onPanResponderRelease: (event: unknown, gesture: Gesture) => void;
};

let dragHandlers: DragHandlers;

const panSpy = jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
  dragHandlers = config as unknown as DragHandlers;
  return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
});
// 关闭动画的回调同步跑完。
const timingSpy = jest.spyOn(Animated, 'timing').mockImplementation(
  () => ({ start: (callback?: Animated.EndCallback) => callback?.({ finished: true }) }) as Animated.CompositeAnimation,
);
const springSpy = jest.spyOn(Animated, 'spring').mockImplementation(
  () => ({ start: () => undefined }) as unknown as Animated.CompositeAnimation,
);

afterAll(() => {
  panSpy.mockRestore();
  timingSpy.mockRestore();
  springSpy.mockRestore();
});

jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: (route: unknown) => mockPush(route), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
  useSegments: () => ['quick-chat'],
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
  useTheme: () => ({ colors: mockThemeColors }),
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

const SHEET_TOP = 250;

function renderSheet() {
  render(<QuickChatScreen />);
  fireEvent(screen.getByTestId('quick-chat-panel'), 'layout', {
    nativeEvent: { layout: { x: 0, y: SHEET_TOP, width: 390, height: 590 } },
  });
}

/**
 * 判定接管时 PanResponder 真实给出的手势:y0 要到接管之后才有值,这时还是 0。
 * 回归:按 y0 判定起点时恒成立,从消息列表开始的下拉也会把半屏拖走。
 */
function moveFrom(startOffset: number, movement: { dx: number; dy: number }): Gesture {
  return { ...movement, vy: 0, y0: 0, moveY: SHEET_TOP + startOffset + movement.dy };
}

function drag(dy: number, vy = 0) {
  const gesture = { dx: 0, dy, vy, y0: SHEET_TOP + 8, moveY: SHEET_TOP + 8 + dy };
  act(() => {
    dragHandlers.onPanResponderMove({}, gesture);
    dragHandlers.onPanResponderRelease({}, gesture);
  });
}

// 回归:横条画出来了却没接手势,用户往下拖没有任何反应。
test('dragging from the top of the sheet follows the finger', () => {
  renderSheet();
  expect(dragHandlers.onMoveShouldSetPanResponderCapture({}, moveFrom(8, { dx: 0, dy: 20 }))).toBe(true);
});

// 只认顶部:消息列表就在下面,从列表开始的下拉必须留给滚动。
test('a drag that starts in the message list is left to the list', () => {
  renderSheet();
  expect(dragHandlers.onMoveShouldSetPanResponderCapture({}, moveFrom(200, { dx: 0, dy: 20 }))).toBe(false);
});

test.each([
  ['upward', { dx: 0, dy: -20 }],
  ['sideways', { dx: 40, dy: 12 }],
  ['a tap with a little jitter', { dx: 0, dy: 3 }],
])('%s movement on the header never takes the gesture from its buttons', (_name, movement) => {
  renderSheet();
  expect(dragHandlers.onMoveShouldSetPanResponderCapture({}, moveFrom(8, movement))).toBe(false);
});

test('dragging far enough closes the sheet', () => {
  renderSheet();
  drag(200);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('a quick flick closes the sheet even when it travels a short way', () => {
  renderSheet();
  drag(70, 2);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('a short drag springs back and keeps the sheet open', () => {
  renderSheet();
  drag(40);
  expect(mockBack).not.toHaveBeenCalled();
  expect(springSpy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0 }));
});

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// 回归:横条用的是描边色,浅色主题 1.27:1、暗色 2.31:1,用户看着和底色一样。
// 3:1 是 WCAG 对非文字界面元素的最低对比度。
test.each([
  ['dark', darkColors],
  ['light', lightColors],
])('the grabber stands out from the %s sheet', (_name, colors) => {
  mockThemeColors = colors as unknown as Record<string, string>;
  render(<QuickChatScreen />);
  const { backgroundColor } = StyleSheet.flatten(screen.getByTestId('quick-chat-grabber').props.style);
  expect(contrastRatio(backgroundColor as string, colors.background)).toBeGreaterThanOrEqual(3);
});

// 暗色下半屏和背后的页面都是纯黑,蒙层也压不出差别,靠一圈描边划出面板的边界。
test('the sheet draws an edge so it separates from the page behind it', () => {
  renderSheet();
  const style = StyleSheet.flatten(screen.getByTestId('quick-chat-panel').props.style);
  expect(style.borderTopWidth).toBeGreaterThan(0);
  expect(style.borderColor).toBe(mockThemeColors.surfaceBorder);
});
