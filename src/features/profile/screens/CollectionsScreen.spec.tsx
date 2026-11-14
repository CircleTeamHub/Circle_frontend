import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CollectionsScreen from './CollectionsScreen';
import { deleteCollection, fetchCollections, getCachedCollections, type UserCollection } from '@/services/api/collections';
import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import { saveMediaToLibrary } from '@/utils/save-image';
import { ImageViewer } from '@/components/ui/image-viewer';
import { NoteVideoViewer } from '@/features/notes/components/NoteVideoViewer';
import { reportHandledFailure } from '@/observability/report-failure';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };
const mockAuth = { user: { id: 'me' }, sessionEpoch: 1 };
let mockPlayerReleased = false;
const mockPlayer = {
  replace: jest.fn(), play: jest.fn(), playing: false,
  pause: jest.fn(() => { if (mockPlayerReleased) throw new Error('Audio player already released'); }),
  release: jest.fn(() => { mockPlayerReleased = true; }),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};
// 一个事件可以有多个订阅者:页面里每个 useFocusEffect 各挂一组 focus/blur。
const mockNavigationListeners = new Map<string, Set<() => void>>();
const mockNavigation = {
  isFocused: () => true,
  addListener: (event: string, listener: () => void) => {
    const listeners = mockNavigationListeners.get(event) ?? new Set<() => void>();
    listeners.add(listener);
    mockNavigationListeners.set(event, listeners);
    return () => { listeners.delete(listener); };
  },
};
const emitNavigation = (event: string) => { for (const listener of [...mockNavigationListeners.get(event) ?? []]) listener(); };
jest.mock('expo-router', () => ({ get router() { return mockRouter; }, useFocusEffect: jest.requireActual('expo-router/build/useFocusEffect').useFocusEffect }));
jest.mock('expo-router/build/link/useLoadedNavigation', () => ({ useOptionalNavigation: () => mockNavigation }));
jest.mock('expo-router/build/useNavigation', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (state: typeof mockAuth) => unknown) => select(mockAuth), { getState: () => mockAuth }) }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => jest.requireActual('expo-modules-core').useReleasingSharedObject(() => {
    mockPlayerReleased = false;
    return mockPlayer;
  }, []),
  setAudioModeAsync: jest.fn(async () => undefined),
}));
const mockTranslate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) value = value.replaceAll('{{' + name + '}}', String(replacement));
  return value;
};
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate, i18n: { language: 'zh-CN' } }) }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { language: 'zh-CN', t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key } }));
jest.mock('@/constants/config', () => ({ API_URL: 'https://api.example.com/api/v1', MEDIA_ORIGINS: ['https://cdn.example.com'] }));
jest.mock('@/utils/dev-log', () => ({ devWarn: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme/tokens'), useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }) }));
jest.mock('@/components/ui/nav-header', () => {
  const { Text, View, Pressable } = jest.requireActual('react-native');
  return { NavHeader: ({ title, rightSlot, onBackPress }: { title: string; rightSlot?: React.ReactNode; onBackPress?: () => void }) => <View><Text>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={onBackPress} />{rightSlot}</View> };
});
jest.mock('@/hooks/use-network-status', () => ({ useNetworkStatus: () => ({ isOffline: false }) }));
// 会话内存快照由真实 fetchCollections 填;这里替身掉 API,快照恒为空(每次进页都走网络)。
jest.mock('@/services/api/collections', () => ({
  fetchCollections: jest.fn(), deleteCollection: jest.fn(),
  getCachedCollections: jest.fn(() => null), collectionsMutatedSince: () => false,
}));
jest.mock('@/services/api/client', () => ({ apiClient: jest.fn(), ApiError: jest.requireActual('@/services/api/api-error').ApiError }));
jest.mock('@/utils/save-image', () => ({ saveMediaToLibrary: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/utils/client-diagnostics', () => ({ logClientDiagnostic: jest.fn() }));
jest.mock('@/components/ui/image-viewer', () => ({ ImageViewer: jest.fn(() => null) }));
jest.mock('@/features/notes/components/NoteVideoViewer', () => ({ NoteVideoViewer: jest.fn(() => null) }));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native');
  return { Image: (props: object) => <View {...props} testID="collection-image" /> };
});

const chatItem: UserCollection = {
  id: 'c-text', userID: 'me', type: 'MESSAGE', title: '周末去爬山', summary: null, sourceID: 'm-text',
  payload: { kind: 'openim-message', messageID: 'm-text', messageType: 'received', text: '周末去爬山，早上八点集合', conversationID: 'sg_group-1', conversationTitle: '登山群', senderID: 'u-2', senderName: '小李' },
  createdAt: '2026-10-30T08:00:00.000Z', updatedAt: '2026-10-30T08:00:00.000Z',
};
function mediaItem(type: 'image' | 'video', id: string = type): UserCollection {
  return { ...chatItem, id, type: type === 'video' ? 'VIDEO' : 'MESSAGE', title: type === 'image' ? '[图片]' : '[视频]', sourceID: 'm-' + id,
    payload: { ...chatItem.payload as object, messageID: 'm-' + id, messageType: type },
    message: { id: 'm-' + id, conversationId: 'sg_group-1', height: 12, type, content: { key: 'chat/u-2/' + id, url: 'https://cdn.example.com/' + id, thumbUrl: 'https://cdn.example.com/poster', width: 640, height: 480, duration: 5 }, sender: { id: 'u-2', nickname: '小李', avatarUrl: null }, replyToId: null, d: null, createdAt: chatItem.createdAt },
  };
}
const row = (id: string) => screen.getByTestId('collection-item-' + id);
beforeEach(() => {
  jest.clearAllMocks();
  mockNavigationListeners.clear();
  mockAuth.user = { id: 'me' }; mockAuth.sessionEpoch += 1;
  useMessageForwardStore.getState().clear();
  jest.mocked(fetchCollections).mockReset().mockResolvedValue([]);
  jest.mocked(deleteCollection).mockReset().mockResolvedValue(undefined);
  jest.mocked(saveMediaToLibrary).mockReset().mockResolvedValue('saved');
});

test('shows the page title and actionable empty state', async () => {
  render(<CollectionsScreen />);
  expect(screen.getByText('我的收藏')).toBeTruthy();
  expect(await screen.findByText('还没有收藏')).toBeTruthy();
});

test('returning from collections does not pause an already released audio player', async () => {
  const view = render(<CollectionsScreen />);
  await screen.findByText('还没有收藏');
  mockPlayer.pause.mockClear();

  expect(() => view.unmount()).not.toThrow();
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
  expect(mockPlayer.pause).not.toHaveBeenCalled();
});

test('leaving collections while it remains mounted still pauses audio', async () => {
  const view = render(<CollectionsScreen />);
  await screen.findByText('还没有收藏');
  mockPlayer.pause.mockClear();

  act(() => { emitNavigation('blur'); });

  expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  expect(mockPlayer.release).not.toHaveBeenCalled();
  view.unmount();
  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
  expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
});
test('failed loads can retry and show actual text', async () => {
  const error = new Error('offline');
  jest.mocked(fetchCollections).mockRejectedValueOnce(error).mockResolvedValueOnce([chatItem]);
  render(<CollectionsScreen />);
  fireEvent.press(await screen.findByText('重试'));
  expect(await screen.findByText('周末去爬山，早上八点集合')).toBeTruthy();
  expect(fetchCollections).toHaveBeenCalledTimes(2);
  expect(reportHandledFailure).toHaveBeenCalledWith('collections', 'load', error);
});
test('shows the image and readable date; tapping previews instead of jumping to chat', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([mediaItem('image')]);
  render(<CollectionsScreen />);
  await screen.findByTestId('collection-item-image');
  expect(screen.getAllByTestId('collection-image').some(image => image.props.source.uri === 'https://cdn.example.com/poster')).toBe(true);
  expect(screen.queryByText(/2026-10-30T08:00:00/)).toBeNull();
  expect(screen.queryByLabelText('更多操作')).toBeNull();
  fireEvent.press(row('image'));
  expect(jest.mocked(ImageViewer).mock.calls.at(-1)?.[0]).toMatchObject({ visible: true, images: ['https://cdn.example.com/image'] });
  expect(mockRouter.push).not.toHaveBeenCalled();
});
test('tapping a video opens full-screen playback', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([mediaItem('video')]);
  render(<CollectionsScreen />);
  fireEvent.press(await screen.findByTestId('collection-item-video'));
  expect(jest.mocked(NoteVideoViewer).mock.calls.at(-1)?.[0].uri).toBe('https://cdn.example.com/video');
});
test('long press selects first item, taps toggle others, cancel exits without mutations', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([chatItem, mediaItem('image')]);
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-c-text'), 'longPress');
  expect(row('c-text')).toBeChecked();
  expect(screen.getByText('已选 1 项')).toBeTruthy();
  fireEvent.press(row('image'));
  expect(screen.getByText('已选 2 项')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(deleteCollection).not.toHaveBeenCalled();
});
test('mixed selection saves media only and leaves unsupported text selected', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([chatItem, mediaItem('image')]);
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-image'), 'longPress');
  fireEvent.press(row('c-text'));
  fireEvent.press(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(saveMediaToLibrary).toHaveBeenCalledTimes(1));
  expect(saveMediaToLibrary).toHaveBeenCalledWith('https://cdn.example.com/image', { mimeType: 'image/jpeg' });
  await waitFor(() => expect(row('image')).not.toBeChecked());
  expect(row('c-text')).toBeChecked();
  expect(logClientDiagnostic).toHaveBeenCalledWith('collections.batch.started', { stage: 'save', selectedCount: 2, total: 1 });
  expect(logClientDiagnostic).toHaveBeenCalledWith('collections.batch.completed', { stage: 'save', succeeded: 1, failed: 0, total: 1 });
});
test('forwards media using real source DTOs through the existing batch picker', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([chatItem, mediaItem('image')]);
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-image'), 'longPress');
  fireEvent.press(row('c-text'));
  fireEvent.press(screen.getByRole('button', { name: '转发' }));
  expect(useMessageForwardStore.getState().pendingBatch).toHaveLength(2);
  expect(useMessageForwardStore.getState().pendingBatch?.find(item => item.message.type === 'image')?.dto).toMatchObject({ id: 'm-image', height: 12 });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/forward-picker' });
});
test('a mixed selection containing an unsupported card disables forwarding', async () => {
  const card = mediaItem('image', 'card');
  card.message = { ...card.message!, type: 'qr-card', content: { token: 'saved-qr' } };
  jest.mocked(fetchCollections).mockResolvedValue([chatItem, card]);
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-card'), 'longPress');
  fireEvent.press(row('c-text'));
  expect(screen.getByRole('button', { name: '转发' })).toBeDisabled();
  expect(useMessageForwardStore.getState().pendingBatch).toBeNull();
});
test('text opens a selectable content sheet and can close without navigating away', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([chatItem]);
  render(<CollectionsScreen />);
  fireEvent.press(await screen.findByTestId('collection-item-c-text'));
  expect(screen.getAllByText('周末去爬山，早上八点集合').some(text => text.props.selectable)).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: '关闭' }));
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(logClientDiagnostic).toHaveBeenCalledWith('collections.open', { stage: 'text' });
});
test('selection back records the action before clearing selection without identifiers', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([chatItem]);
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-c-text'), 'longPress');
  fireEvent.press(screen.getByRole('button', { name: '返回' }));
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(logClientDiagnostic).toHaveBeenCalledWith('collections.back', { reason: 'header', selectedCount: 1 });
});
test('saving cannot submit twice or cancel while the album write is in progress', async () => {
  let finish!: (result: 'saved') => void;
  jest.mocked(saveMediaToLibrary).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  jest.mocked(fetchCollections).mockResolvedValue([mediaItem('image')]);
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-image'), 'longPress');
  let save = screen.getByRole('button', { name: '保存' });
  while (save.parent && typeof save.props.onPress !== 'function') save = save.parent;
  act(() => { save.props.onPress(); save.props.onPress(); });
  expect(saveMediaToLibrary).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  await act(async () => finish('saved'));
  await waitFor(() => expect(screen.queryAllByRole('checkbox')).toHaveLength(0));
});
test('batch delete confirms once, removes successes and retains failed selection', async () => {
  const error = new Error('offline');
  jest.mocked(fetchCollections).mockResolvedValue([chatItem, mediaItem('image')]);
  jest.mocked(deleteCollection).mockImplementation(async id => { if (id === 'c-text') throw error; });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    render(<CollectionsScreen />);
    fireEvent(await screen.findByTestId('collection-item-image'), 'longPress');
    fireEvent.press(row('c-text'));
    fireEvent.press(screen.getByRole('button', { name: '删除' }));
    expect(deleteCollection).not.toHaveBeenCalled();
    await act(async () => { await alert.mock.calls.at(-1)?.[2]?.find(button => button.style === 'destructive')?.onPress?.(); });
    await waitFor(() => expect(screen.queryByTestId('collection-item-image')).toBeNull());
    expect(row('c-text')).toBeChecked();
    expect(reportHandledFailure).toHaveBeenCalledWith('collections', 'batch', error, { reason: 'delete' });
  } finally { alert.mockRestore(); }
});
test('a thrown album save keeps selection and reports without collection content', async () => {
  const error = new Error('album unavailable');
  jest.mocked(fetchCollections).mockResolvedValue([mediaItem('image')]);
  jest.mocked(saveMediaToLibrary).mockRejectedValueOnce(error);
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-image'), 'longPress');
  fireEvent.press(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('已保存 0 项，1 项失败，0 项不支持保存');
  expect(row('image')).toBeChecked();
  expect(reportHandledFailure).toHaveBeenCalledWith('collections', 'batch', error, { reason: 'save' });
});
test('album permission denial keeps selection without reporting an exception', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([mediaItem('image')]);
  jest.mocked(saveMediaToLibrary).mockResolvedValueOnce('denied');
  render(<CollectionsScreen />);
  fireEvent(await screen.findByTestId('collection-item-image'), 'longPress');
  fireEvent.press(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('请允许访问相册后重试');
  expect(reportHandledFailure).not.toHaveBeenCalled();
});
test('a failed voice play reports the native failure without the media URL', async () => {
  const voice = mediaItem('image', 'voice');
  voice.type = 'VOICE';
  voice.message = { ...voice.message!, type: 'voice', content: { url: 'https://cdn.example.com/private-voice', duration: 2 } };
  const error = new Error('player unavailable');
  mockPlayer.play.mockImplementationOnce(() => { throw error; });
  jest.mocked(fetchCollections).mockResolvedValue([voice]);
  render(<CollectionsScreen />);
  fireEvent.press(await screen.findByTestId('collection-item-voice'));
  await screen.findByText('内容暂不可用');
  expect(reportHandledFailure).toHaveBeenCalledWith('collections', 'voicePlayback', error);
});
test('previous-account delete confirmation cannot act after account switch', async () => {
  jest.mocked(fetchCollections).mockResolvedValue([chatItem]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    render(<CollectionsScreen />);
    fireEvent(await screen.findByTestId('collection-item-c-text'), 'longPress');
    fireEvent.press(screen.getByRole('button', { name: '删除' }));
    const confirm = alert.mock.calls.at(-1)?.[2]?.find(button => button.style === 'destructive');
    mockAuth.sessionEpoch += 1; mockAuth.user = { id: 'other' };
    await act(async () => { await confirm?.onPress?.(); });
    expect(deleteCollection).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

// 进页不卡:会话内存里已有的收藏首帧不画,下一帧再画,中间也不闪「还没有收藏」。
test('cached collections render on the next frame without flashing the empty state', async () => {
  jest.mocked(getCachedCollections).mockReturnValueOnce({ items: [chatItem] } as never);
  jest.mocked(fetchCollections).mockReturnValue(new Promise(() => undefined));
  render(<CollectionsScreen />);
  expect(screen.getByText('我的收藏')).toBeTruthy();
  expect(screen.queryByTestId('collection-item-c-text')).toBeNull();
  expect(screen.queryByText('还没有收藏')).toBeNull();
  expect(await screen.findByTestId('collection-item-c-text')).toBeTruthy();
});
