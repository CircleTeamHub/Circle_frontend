import React from 'react';
import { Alert, TextInput, View } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import EditGroupNoticeScreen from './EditGroupNoticeScreen';
import { createCircleChatConversation, setGroupChatNotice } from '@/chat-core/api';

const mockParams: Record<string, string> = {};
const mockRouter = jest.requireMock('expo-router').router as { back: jest.Mock };
const mockUpsert = jest.fn();
const mockConversation = { id: 'conversation', type: 'GROUP', notice: '公告正文', noticePinned: false };
jest.mock('expo-router', () => ({ router: { back: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({ KeyboardAvoidingContainer: (props: React.ComponentProps<typeof View>) => {
  const { View: NativeView } = jest.requireActual<typeof import('react-native')>('react-native');
  return <NativeView {...props} />;
} }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme/tokens'), useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }) }));
jest.mock('@/chat-core/api', () => ({ setGroupChatNotice: jest.fn(), createCircleChatConversation: jest.fn() }));
jest.mock('@/chat-core/store', () => ({ useChatStore: { getState: () => ({ conversations: [mockConversation], upsertConversation: mockUpsert }) } }));
jest.mock('@/services/api/circles', () => ({ markCircleWrite: (request: Promise<unknown>) => request }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockParams).forEach(key => delete mockParams[key]);
  Object.assign(mockParams, { conversationID: 'conversation', notice: '公告正文', noticePinned: 'false' });
  jest.mocked(setGroupChatNotice).mockImplementation(async (_id, notice, noticePinned) => ({ notice, noticePinned }));
  jest.mocked(createCircleChatConversation).mockResolvedValue({ id: 'conversation' } as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('saves a broadcast-only change even when the notice text is unchanged', async () => {
  render(<EditGroupNoticeScreen />);
  fireEvent(screen.getByRole('switch', { name: 'chat.noticePinned' }), 'valueChange', true);
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(setGroupChatNotice).toHaveBeenCalledWith('conversation', '公告正文', true));
  expect(mockUpsert).toHaveBeenCalledWith({ ...mockConversation, noticePinned: true });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('circle groups save text and broadcast through the same atomic notice endpoint', async () => {
  delete mockParams.conversationID;
  mockParams.groupID = 'circle';
  render(<EditGroupNoticeScreen />);
  fireEvent.changeText(screen.UNSAFE_getByType(TextInput), '新的公告');
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(setGroupChatNotice).toHaveBeenCalledWith('conversation', '新的公告', true));
  expect(createCircleChatConversation).toHaveBeenCalledWith('circle');
});

test('switching broadcast off persists while retaining the notice', async () => {
  mockParams.noticePinned = 'true';
  render(<EditGroupNoticeScreen />);
  expect(screen.getByRole('switch').props.value).toBe(true);
  fireEvent(screen.getByRole('switch'), 'valueChange', false);
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(setGroupChatNotice).toHaveBeenCalledWith('conversation', '公告正文', false));
});

test('an empty notice disables broadcast and saves the flag as false', async () => {
  mockParams.noticePinned = 'true';
  render(<EditGroupNoticeScreen />);
  fireEvent.changeText(screen.UNSAFE_getByType(TextInput), '  ');
  expect(screen.getByRole('switch').props.disabled).toBe(true);
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(setGroupChatNotice).toHaveBeenCalledWith('conversation', '', false));
});

test('a failed save keeps the edited text and switch for retry', async () => {
  jest.mocked(setGroupChatNotice).mockRejectedValue(new Error('offline'));
  render(<EditGroupNoticeScreen />);
  fireEvent.changeText(screen.UNSAFE_getByType(TextInput), '待保存公告');
  fireEvent(screen.getByRole('switch'), 'valueChange', true);
  fireEvent.press(screen.getByText('common.save'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(screen.UNSAFE_getByType(TextInput).props.value).toBe('待保存公告');
  expect(screen.getByRole('switch').props.value).toBe(true);
});

test('unchanged settings return without making another write', () => {
  render(<EditGroupNoticeScreen />);
  fireEvent.press(screen.getByText('common.save'));
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(setGroupChatNotice).not.toHaveBeenCalled();
});
