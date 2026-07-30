import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { MomentCommentInput } from './moment-comment-input';
import { fetchFriends } from '@/services/api/friends';
import * as ImagePicker from 'expo-image-picker';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/storage', () => ({
  storage: { getString: jest.fn(), set: jest.fn() },
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: jest.fn() },
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  resolveUploadContentType: jest.fn(),
  sanitizeUploadFilename: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));

const alice = {
  id: 'alice-id',
  accountId: 'alice',
  nickname: 'Alice',
  avatarUrl: null,
  avatarFrame: null,
  avatarFrameAppearance: null,
  gender: 'UNKNOWN',
  lastOnline: null,
  friendsSince: '2026-01-01',
  remark: null,
};
const alex1 = { ...alice, id: 'alex-1', accountId: 'alex1', nickname: 'Alex' };
const alex2 = { ...alice, id: 'alex-2', accountId: 'alex2', nickname: 'Alex' };

const mockFetchFriends = fetchFriends as jest.MockedFunction<typeof fetchFriends>;
const mockPicker = ImagePicker.launchImageLibraryAsync as jest.Mock;
const mockPresign = requestUploadPresign as jest.MockedFunction<
  typeof requestUploadPresign
>;
const mockResolveContentType = resolveUploadContentType as jest.MockedFunction<
  typeof resolveUploadContentType
>;
const mockSanitizeFilename = sanitizeUploadFilename as jest.MockedFunction<
  typeof sanitizeUploadFilename
>;
const mockUpload = uploadLocalFileToPresignedUrl as jest.MockedFunction<
  typeof uploadLocalFileToPresignedUrl
>;

async function selectAlice() {
  fireEvent.press(screen.getByLabelText('提到好友'));
  await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
  fireEvent.press(screen.getByText('Alice'));
}

async function selectAlex(index: number) {
  fireEvent.press(screen.getByLabelText('提到好友'));
  await waitFor(() => expect(screen.getAllByText('Alex')).toHaveLength(2));
  fireEvent.press(screen.getAllByText('Alex')[index]);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockFetchFriends.mockResolvedValue([alice, alex1, alex2]);
  mockPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://comment.jpg' }],
  });
  mockResolveContentType.mockReturnValue('image/jpeg');
  mockSanitizeFilename.mockReturnValue('comment.jpg');
  mockPresign.mockResolvedValue({
    uploadUrl: 'https://upload/comment',
    fileUrl: 'https://cdn/comment.jpg',
    key: 'posts/comment.jpg',
  });
  mockUpload.mockResolvedValue({
    status: 200,
    headers: {},
    mimeType: null,
    body: '',
  });
});

test('the 21st unique mention is not appended and shows the localized limit message', async () => {
  const friends = Array.from({ length: 21 }, (_, index) => ({
    ...alice,
    id: `user-${index}`,
    accountId: `user-${index}`,
    nickname: `User${index}`,
  }));
  mockFetchFriends.mockResolvedValue(friends);
  render(
    <MomentCommentInput
      replyTo={null}
      onSubmit={jest.fn()}
      onDismiss={jest.fn()}
    />,
  );

  for (const friend of friends) {
    fireEvent.press(screen.getByLabelText('提到好友'));
    await waitFor(() => expect(screen.getByText(friend.nickname)).toBeTruthy());
    fireEvent.press(screen.getByText(friend.nickname));
  }

  const input = screen.getByPlaceholderText('写评论...');
  expect(input.props.value).toContain('@User19');
  expect(input.props.value).not.toContain('@User20');
  expect(Alert.alert).toHaveBeenCalledWith(expect.stringContaining('20'));
});

test('two synchronous submits run onSubmit once and the lock releases after success', async () => {
  let resolveSubmit: () => void = () => {};
  const onSubmit = jest
    .fn()
    .mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveSubmit = resolve)),
    )
    .mockResolvedValueOnce(undefined);
  render(
    <MomentCommentInput
      replyTo={null}
      onSubmit={onSubmit}
      onDismiss={jest.fn()}
    />,
  );
  const input = screen.getByPlaceholderText('写评论...');
  fireEvent.changeText(input, 'first');

  await act(async () => {
    fireEvent(input, 'submitEditing');
    fireEvent(input, 'submitEditing');
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);

  await act(async () => resolveSubmit());
  fireEvent.changeText(input, 'second');
  await act(async () => {
    fireEvent(input, 'submitEditing');
  });
  expect(onSubmit).toHaveBeenCalledTimes(2);
});

test('two synchronous image submits start one upload', async () => {
  let resolvePresign: (
    value: Awaited<ReturnType<typeof requestUploadPresign>>,
  ) => void = () => {};
  mockPresign.mockImplementationOnce(
    () => new Promise((resolve) => (resolvePresign = resolve)),
  );
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <MomentCommentInput
      replyTo={null}
      onSubmit={onSubmit}
      onDismiss={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByLabelText('添加图片'));
  await waitFor(() => expect(screen.getByLabelText('删除')).toBeTruthy());
  const input = screen.getByPlaceholderText('写评论...');
  await act(async () => {
    fireEvent(input, 'submitEditing');
    fireEvent(input, 'submitEditing');
  });
  expect(mockPresign).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolvePresign({
      uploadUrl: 'https://upload/comment',
      fileUrl: 'https://cdn/comment.jpg',
      key: 'posts/comment.jpg',
    });
  });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
});

test('success clears text, image, and mention selection without resurrecting a manually typed mention', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <MomentCommentInput
      replyTo={null}
      onSubmit={onSubmit}
      onDismiss={jest.fn()}
    />,
  );

  await selectAlice();
  await selectAlice();
  fireEvent.press(screen.getByLabelText('添加图片'));
  await waitFor(() => expect(screen.getByLabelText('删除')).toBeTruthy());

  await act(async () => {
    fireEvent(screen.getByPlaceholderText('写评论...'), 'submitEditing');
  });

  expect(onSubmit).toHaveBeenCalledWith(
    '@Alice',
    undefined,
    ['https://cdn/comment.jpg'],
    ['alice-id'],
  );
  expect(screen.getByPlaceholderText('写评论...').props.value).toBe('');
  expect(screen.queryByLabelText('删除')).toBeNull();

  fireEvent.changeText(
    screen.getByPlaceholderText('写评论...'),
    'manually typed @Alice',
  );
  await act(async () => {
    fireEvent(screen.getByPlaceholderText('写评论...'), 'submitEditing');
  });

  expect(onSubmit).toHaveBeenLastCalledWith(
    'manually typed @Alice',
    undefined,
    undefined,
    [],
  );
});

test('same-nickname selections keep separate ids and deleting the first keeps only the second', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <MomentCommentInput
      replyTo={null}
      onSubmit={onSubmit}
      onDismiss={jest.fn()}
    />,
  );

  await selectAlex(0);
  await selectAlex(1);
  const input = screen.getByPlaceholderText('写评论...');
  expect(input.props.value).toBe('@Alex @Alex ');

  fireEvent(input, 'selectionChange', {
    nativeEvent: { selection: { start: 0, end: 6 } },
  });
  fireEvent.changeText(input, '@Alex ');
  await act(async () => {
    fireEvent(input, 'submitEditing');
  });

  expect(onSubmit).toHaveBeenCalledWith(
    '@Alex',
    undefined,
    undefined,
    ['alex-2'],
  );
});

test('deleting a selected mention prunes it so manual retyping does not send its id', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <MomentCommentInput
      replyTo={null}
      onSubmit={onSubmit}
      onDismiss={jest.fn()}
    />,
  );

  await selectAlice();
  const input = screen.getByPlaceholderText('写评论...');
  fireEvent.changeText(input, 'mention deleted');
  fireEvent.changeText(input, 'manually typed @Alice');
  await act(async () => {
    fireEvent(input, 'submitEditing');
  });

  expect(onSubmit).toHaveBeenCalledWith(
    'manually typed @Alice',
    undefined,
    undefined,
    [],
  );
});

test('submit rejection retains the draft and selected mention for retry', async () => {
  const onSubmit = jest
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(undefined);
  render(
    <MomentCommentInput
      replyTo={null}
      onSubmit={onSubmit}
      onDismiss={jest.fn()}
    />,
  );

  await selectAlice();
  const input = screen.getByPlaceholderText('写评论...');
  fireEvent(input, 'selectionChange', {
    nativeEvent: { selection: { start: 0, end: 0 } },
  });
  fireEvent.changeText(input, 'retry @Alice ');

  await act(async () => {
    fireEvent(input, 'submitEditing');
  });
  expect(input.props.value).toBe('retry @Alice ');
  expect(onSubmit).toHaveBeenLastCalledWith(
    'retry @Alice',
    undefined,
    undefined,
    ['alice-id'],
  );

  await act(async () => {
    fireEvent(input, 'submitEditing');
  });
  expect(onSubmit).toHaveBeenCalledTimes(2);
  expect(onSubmit).toHaveBeenLastCalledWith(
    'retry @Alice',
    undefined,
    undefined,
    ['alice-id'],
  );
});
