import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
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
  gender: 'UNKNOWN',
  lastOnline: null,
  friendsSince: '2026-01-01',
  remark: null,
};

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

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchFriends.mockResolvedValue([alice]);
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
    '@Alice @Alice',
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
  fireEvent.changeText(input, 'retry @Alice');

  await act(async () => {
    fireEvent(input, 'submitEditing');
  });
  expect(input.props.value).toBe('retry @Alice');
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
