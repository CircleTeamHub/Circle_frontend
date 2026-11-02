import { render } from '@testing-library/react-native';
import { ChatConnectionBanner } from './ChatConnectionBanner';

interface MockChatState {
  currentUserId: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

let mockChatState: MockChatState;
const BANNER = 'chat-connection-banner';

jest.mock('@/chat-core/store', () => ({
  useChatStore: <T,>(selector: (state: MockChatState) => T) => selector(mockChatState),
}));
jest.mock('@/theme', () => ({
  Radius: { md: 8 },
  Spacing: { sm: 8, md: 16 },
  Typography: { small: {} },
  useTheme: () => ({ colors: { warning: 'orange', white: 'white' } }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const offline = (error: string | null, patch: Partial<MockChatState> = {}): MockChatState => ({
  currentUserId: 'u-1',
  connected: false,
  connecting: false,
  error,
  ...patch,
});

test('says the server is unreachable once the handshake times out', () => {
  mockChatState = offline('timeout');
  const view = render(<ChatConnectionBanner />);
  expect(view.getByTestId(BANNER)).toBeTruthy();
  expect(view.getByText('messages.imServerUnreachable')).toBeTruthy();
});

test('stays up while socket.io keeps retrying after a failure', () => {
  // 回前台时 connectChat 会把 connecting 置回 true;上一次的失败还没被一次成功抵消,
  // 提示不能因此消失,否则每次切回 App 都要再等一个握手超时(20 秒)才重新出现。
  mockChatState = offline('network_error', { connecting: true });
  const view = render(<ChatConnectionBanner />);
  expect(view.getByText('messages.imServerUnreachable')).toBeTruthy();
});

test('reports a server-side refusal separately from an unreachable server', () => {
  mockChatState = offline('server_error');
  const view = render(<ChatConnectionBanner />);
  expect(view.getByText('messages.imServerError')).toBeTruthy();
});

test('disappears once the connection is back', () => {
  mockChatState = offline('timeout');
  const view = render(<ChatConnectionBanner />);
  expect(view.getByTestId(BANNER)).toBeTruthy();
  mockChatState = offline(null, { connected: true });
  view.rerender(<ChatConnectionBanner />);
  expect(view.queryByTestId(BANNER)).toBeNull();
});

test('renders nothing before any failure', () => {
  mockChatState = offline(null, { connecting: true });
  const view = render(<ChatConnectionBanner />);
  expect(view.queryByTestId(BANNER)).toBeNull();
});
