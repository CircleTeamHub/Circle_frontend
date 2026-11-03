import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { saveImageToLibrary } from '@/utils/save-image';
import type { ChatMessage } from '@/types';
import { useMessageRenderer, type MessageRendererParams } from './use-message-renderer';

const mockAvatarRender = jest.fn();
const mockRemarks = {};
jest.mock('@/stores/friendRemarkStore', () => ({
  useFriendRemarkStore: (select: (state: unknown) => unknown) => select({ remarks: mockRemarks }),
}));
jest.mock('@/features/chat/components/chat-bubble', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ImageBubble: jest.requireActual<typeof import('../../components/bubbles/image-bubble')>('../../components/bubbles/image-bubble').ImageBubble,
    SystemNoticePill: ({ text }: { text: string }) => <Text>{text}</Text>,
  };
});
jest.mock('@/features/chat/components/bubbles/shared', () => ({
  MessageAvatar: ({ message }: { message: ChatMessage }) => { mockAvatarRender(message.id); return null; },
  BubbleStatusText: () => null,
}));
jest.mock('@/features/chat/components/FailedMessageRetry', () => ({
  FailedMessageRetry: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/features/groups/GroupInvitationBubble', () => ({ GroupInvitationBubble: () => null }));
jest.mock('@/features/groups/routes', () => ({}));
jest.mock('@/features/user/utils/routes', () => ({}));
jest.mock('@/components/ui/member-name', () => ({ MemberName: () => null }));
jest.mock('@/features/chat/chat-detail/styles', () => ({ chatDetailStyles: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: () => <View /> };
});
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/storage', () => ({ storage: { getString: jest.fn(), set: jest.fn() } }));
jest.mock('@/components/ui/zoomable-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ZoomableImage: (props: object) => <View testID="gallery-photo" {...props} /> };
});
jest.mock('@/utils/save-image', () => ({ saveImageToLibrary: jest.fn().mockResolvedValue('saved') }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  Radius: { md: 12, xl: 20, full: 9999 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { tinyRegular: {}, body: {} },
  useTheme: () => ({ colors: { text: '#111', surface: '#fff', overlay: '#000', textSecondary: '#666' } }),
}));

const params = {
  selectedMessageIds: null,
  handleToggleSelectedMessage: jest.fn(),
  colors: { text: '#111', iconAccent: '#6200ee' },
  scope: 'messages',
  groupMemberNames: {},
  selfDestructEnabled: false,
  selfDestructCacheKey: '',
  isGroupChat: false,
  conversationTitle: 'Chat',
  handleOpenMessageSender: jest.fn(),
  handleOpenSelfProfile: jest.fn(),
  handleOpenUserCard: jest.fn(),
  hideChatAvatar: false,
  d: {},
  highlightedMessageID: null,
  handleQuotePress: jest.fn(),
  handleToggleReaction: jest.fn(),
  getMessageLongPressHandler: jest.fn(() => jest.fn()),
  handleStartCall: jest.fn(),
  handleRetryMessage: jest.fn(),
} as unknown as Omit<MessageRendererParams, 'messages'>;

function Messages({ messages }: { messages: ChatMessage[] }) {
  const { renderItem, keyExtractor } = useMessageRenderer({ ...params, messages });
  return <>{messages.map((item) => <React.Fragment key={keyExtractor(item)}>{renderItem({ item })}</React.Fragment>)}</>;
}

const photo = (id: string): ChatMessage => ({ id, type: 'image', imageUrl: `https://example.test/${id}.jpg` });
const older = photo('older');
const anchor = photo('anchor');
const newer = photo('newer');
const revoked = (message: ChatMessage): ChatMessage => ({ id: message.id, type: 'system-notice', text: 'revoked' });
const galleryImages = () => screen.UNSAFE_getByType(FlatList).props.data;
const activePhoto = () => screen.getAllByTestId('gallery-photo').find((item) => item.props.active)!;
function openAnchor() {
  // The list is inverted; its current loaded page is newest first.
  fireEvent.press(screen.getAllByTestId('chat-image-preview')[1]);
}
function swipeTo(index: number) {
  const list = screen.UNSAFE_getByType(FlatList);
  fireEvent(list, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: list.props.getItemLayout(null, index).offset } } });
}

beforeEach(() => {
  mockAvatarRender.mockClear();
  jest.mocked(saveImageToLibrary).mockClear();
});

test.each([older, newer])('an open gallery drops revoked neighbor $id while its anchor row stays memoized', (neighbor) => {
  const view = render(<Messages messages={[newer, anchor, older]} />);
  openAnchor();
  expect(galleryImages()).toEqual([older.imageUrl, anchor.imageUrl, newer.imageUrl]);
  expect(screen.UNSAFE_getByType(FlatList).props.initialScrollIndex).toBe(1);
  const unchangedNeighbor = neighbor === older ? newer : older;
  const inactiveRenders = mockAvatarRender.mock.calls.filter(([id]) => id === unchangedNeighbor.id).length;

  view.rerender(<Messages messages={[newer, anchor, older].map((item) => item === neighbor ? revoked(item) : item)} />);

  expect(galleryImages()).toEqual([older, anchor, newer].filter((item) => item !== neighbor).map((item) => item.imageUrl));
  expect(mockAvatarRender.mock.calls.filter(([id]) => id === unchangedNeighbor.id)).toHaveLength(inactiveRenders);
});

test('revoking the currently viewed last neighbor closes its save menu and resets to a valid photo', async () => {
  const view = render(<Messages messages={[newer, anchor, older]} />);
  openAnchor();
  swipeTo(2);
  expect(activePhoto().props.uri).toBe(newer.imageUrl);
  fireEvent(activePhoto(), 'longPress');
  expect(screen.getByTestId('image-action-sheet')).toBeTruthy();

  view.rerender(<Messages messages={[revoked(newer), anchor, older]} />);

  expect(galleryImages()).toEqual([older.imageUrl, anchor.imageUrl]);
  expect(screen.queryByTestId('image-action-sheet')).toBeNull();
  expect(activePhoto().props.uri).toBe(anchor.imageUrl);
  fireEvent(activePhoto(), 'longPress');
  await act(async () => { fireEvent.press(screen.getByLabelText('media.saveImage')); });
  expect(saveImageToLibrary).toHaveBeenCalledWith(anchor.imageUrl);
});

test('removing a photo before the tapped anchor resets the gallery to the anchor at its new index', () => {
  const view = render(<Messages messages={[newer, anchor, older]} />);
  openAnchor();
  swipeTo(2);
  view.rerender(<Messages messages={[newer, anchor, revoked(older)]} />);
  expect(galleryImages()).toEqual([anchor.imageUrl, newer.imageUrl]);
  expect(screen.UNSAFE_getByType(FlatList).props.initialScrollIndex).toBe(0);
  expect(activePhoto().props.uri).toBe(anchor.imageUrl);
});

test('revoking the anchor unmounts its gallery and save menu', () => {
  const view = render(<Messages messages={[newer, anchor, older]} />);
  openAnchor();
  fireEvent(activePhoto(), 'longPress');
  view.rerender(<Messages messages={[newer, revoked(anchor), older]} />);
  expect(screen.queryByTestId('gallery-photo')).toBeNull();
  expect(screen.queryByTestId('image-action-sheet')).toBeNull();
});

test('new arrivals keep the open gallery on its loaded page and are included on the next open', () => {
  const view = render(<Messages messages={[newer, anchor, older]} />);
  openAnchor();
  const arrival = photo('arrival');
  swipeTo(2);
  view.rerender(<Messages messages={[arrival, newer, anchor, older]} />);
  expect(galleryImages()).toEqual([older.imageUrl, anchor.imageUrl, newer.imageUrl]);
  expect(activePhoto().props.uri).toBe(newer.imageUrl);
  fireEvent.press(screen.getByLabelText('common.close'));
  fireEvent.press(screen.getAllByTestId('chat-image-preview')[2]);
  expect(galleryImages()).toEqual([older.imageUrl, anchor.imageUrl, newer.imageUrl, arrival.imageUrl]);
});

test('an uploading neighbor keeps its gallery position and live URI after acknowledgment', () => {
  const uploading: ChatMessage = { ...newer, id: 'local:upload', deliveryId: 'upload', imageUrl: 'file:///upload.jpg', outgoing: true, sendStatus: 1 };
  const acknowledged: ChatMessage = { ...uploading, id: 'server-upload', imageUrl: newer.imageUrl, sendStatus: 2 };
  const view = render(<Messages messages={[uploading, anchor, older]} />);
  openAnchor();
  swipeTo(2);
  expect(activePhoto().props.uri).toBe(uploading.imageUrl);

  view.rerender(<Messages messages={[acknowledged, anchor, older]} />);

  expect(galleryImages()).toEqual([older.imageUrl, anchor.imageUrl, acknowledged.imageUrl]);
  expect(activePhoto().props.uri).toBe(acknowledged.imageUrl);
});

test('acknowledging the tapped anchor preserves its gallery and the currently viewed neighbor', () => {
  const uploading: ChatMessage = { ...anchor, id: 'local:anchor-upload', deliveryId: 'anchor-upload', imageUrl: 'file:///anchor-upload.jpg', outgoing: true, sendStatus: 1 };
  const acknowledged: ChatMessage = { ...uploading, id: 'server-anchor', imageUrl: anchor.imageUrl, sendStatus: 2 };
  const view = render(<Messages messages={[newer, uploading, older]} />);
  openAnchor();
  swipeTo(2);

  view.rerender(<Messages messages={[newer, acknowledged, older]} />);

  expect(galleryImages()).toEqual([older.imageUrl, acknowledged.imageUrl, newer.imageUrl]);
  expect(activePhoto().props.uri).toBe(newer.imageUrl);
});
