import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChatDetailHeader, type ChatDetailHeaderProps } from './ChatDetailHeader';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { lightColors } from '@/theme/colors';
import { Spacing } from '@/theme';

const mockPush = jest.fn();
jest.mock('@/features/chat/chat-detail/hooks/use-chat-router', () => ({
  useChatRouter: () => ({ push: mockPush }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
// 玻璃材质是原生视图,这里只关心它包住了什么。
jest.mock('@/components/ui/glass-surface', () => {
  const { View } = jest.requireActual('react-native');
  return { GlassSurface: View };
});
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/features/assistant/components/AssistantFloatingHeader', () => {
  const { Text } = jest.requireActual('react-native');
  return { AssistantFloatingHeader: () => <Text>assistant-header</Text> };
});

function renderHeader(overrides: Partial<ChatDetailHeaderProps> = {}) {
  const props: ChatDetailHeaderProps = {
    embedded: undefined,
    colors: lightColors,
    scope: 'messages',
    sourceID: 'peer-1',
    conversationID: 'conv-1',
    isTempChat: false,
    isAssistant: false,
    isGroupChat: false,
    conversationTitle: '无敌真寂寞',
    avatarUrl: undefined,
    handleBack: jest.fn(),
    handleOpenHeaderTarget: jest.fn(),
    headerStatusText: '1小时前在线',
    statusColor: '#8E8E93',
    fadeColor: '#F7F7F8',
    ...overrides,
  };
  render(<ChatDetailHeader {...props} />);
  return props;
}

beforeEach(() => mockPush.mockClear());

test('back, title pill and more are three separate round controls', () => {
  const props = renderHeader();

  fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatBack));
  expect(props.handleBack).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy();

  // 整颗胶囊都能点,不再只有头像那 36pt。
  fireEvent.press(screen.getByRole('button', { name: '无敌真寂寞' }));
  expect(props.handleOpenHeaderTarget).toHaveBeenCalledTimes(1);
  expect(screen.getByText('1小时前在线')).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'chat.chatInfo' }));
  expect(mockPush).toHaveBeenCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({ conversationID: 'conv-1', conversationType: 'private' }),
    }),
  );
});

test('the header clears the status bar and sits on a fade of the chat background', () => {
  renderHeader();
  const header = screen.getByTestId('chat-detail-header');
  expect(StyleSheet.flatten(header.props.style).paddingTop).toBe(47 + Spacing.xs);
  expect(screen.getByTestId('chat-detail-header-fade')).toBeTruthy();
});

test('the half-screen sheet swaps back/more for close/expand and skips the status bar', () => {
  const sheet = { onClose: jest.fn(), onExpand: jest.fn() };
  renderHeader({ sheet });

  fireEvent.press(screen.getByRole('button', { name: 'common.close' }));
  expect(sheet.onClose).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'chat.quickChat.expand' }));
  expect(sheet.onExpand).toHaveBeenCalledTimes(1);

  expect(screen.queryByTestId(E2E_TEST_IDS.chatBack)).toBeNull();
  expect(screen.queryByRole('button', { name: 'chat.chatInfo' })).toBeNull();
  const header = screen.getByTestId('chat-detail-header');
  expect(StyleSheet.flatten(header.props.style).paddingTop).toBe(Spacing.sm);
});

test('the title capsule is centred between the two round buttons', () => {
  renderHeader();
  const slot = screen.getByTestId('chat-detail-header-title-slot');
  expect(StyleSheet.flatten(slot.props.style)).toMatchObject({ flex: 1, justifyContent: 'center' });
  // 名字和在线状态上下也居中对齐。
  const text = screen.getByTestId('chat-detail-header-title-text');
  expect(StyleSheet.flatten(text.props.style).alignItems).toBe('center');
  expect(screen.queryByTestId('chat-detail-header-leading-spacer')).toBeNull();
});

test('the desktop split pane has no back button but keeps the title centred', () => {
  renderHeader({ embedded: { conversationID: 'conv-1' } });
  expect(screen.queryByTestId(E2E_TEST_IDS.chatBack)).toBeNull();
  expect(screen.getByRole('button', { name: '无敌真寂寞' })).toBeTruthy();
  // 左边空出一颗按钮的位,标题仍在正中,而不是往左偏。
  const spacer = screen.getByTestId('chat-detail-header-leading-spacer');
  expect(StyleSheet.flatten(spacer.props.style).width).toBe(44);
});

test('no status line when there is nothing to show', () => {
  renderHeader({ headerStatusText: '' });
  expect(screen.queryByTestId('chat-detail-header-status')).toBeNull();
});

test('the assistant keeps its own character header', () => {
  renderHeader({ isAssistant: true });
  expect(screen.getByText('assistant-header')).toBeTruthy();
  expect(screen.queryByTestId('chat-detail-header')).toBeNull();
});
