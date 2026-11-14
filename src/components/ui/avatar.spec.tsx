import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Avatar } from './avatar';
import { CircleAvatar } from './circle-avatar';
import { GroupChatAvatar } from './group-chat-avatar';

jest.mock('@/features/profile/membership-frames', () => ({ AVATAR_FRAME_SCALE: 1.6, AVATAR_FRAME_COMPACT_SCALE: 1.2 }));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const React = jest.requireActual<typeof import('react')>('react');
  return { Image: function MockImage(props: { source: { uri: string }; recyclingKey?: string }) {
    const [displayedUri, setDisplayedUri] = React.useState<string>();
    React.useLayoutEffect(() => setDisplayedUri(undefined), [props.recyclingKey]);
    const loadProps = { onLoad: () => setDisplayedUri(props.source.uri) };
    return <View {...props} {...loadProps} testID="avatar-image" accessibilityLabel={displayedUri ?? 'loading'} />;
  } };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('./gradient-cover', () => ({ GradientCover: () => null }));
jest.mock('@/theme', () => ({ Radius: { sm: 8 }, useTheme: () => ({ colors: { surface: '#fff' } }) }));

test('keeps the displayed avatar while the same account replacement is loading', () => {
  const view = render(<Avatar identityKey="account-a" uri="https://image.test/old" />);
  fireEvent(screen.getByTestId('avatar-image'), 'load');
  view.rerender(<Avatar identityKey="account-a" uri="https://image.test/new" />);
  expect(screen.getByLabelText('https://image.test/old')).toBeTruthy();
  fireEvent(screen.getByTestId('avatar-image'), 'load');
  expect(screen.getByLabelText('https://image.test/new')).toBeTruthy();
});

test('clears the previous account image when its identity changes, even with the same URL', () => {
  const view = render(<Avatar identityKey="account-a" uri="https://image.test/shared" />);
  fireEvent(screen.getByTestId('avatar-image'), 'load');
  view.rerender(<Avatar identityKey="account-b" uri="https://image.test/shared" />);
  expect(screen.queryByLabelText('https://image.test/shared')).toBeNull();
});

test('avatars without an identity still clear an old list item when their source changes', () => {
  const view = render(<Avatar uri="https://image.test/a" />);
  fireEvent(screen.getByTestId('avatar-image'), 'load');
  view.rerender(<Avatar uri="https://image.test/b" />);
  expect(screen.queryByLabelText('https://image.test/a')).toBeNull();
});

test('keeps the default avatar behind a pending image and after a failed load', () => {
  render(<Avatar identityKey="account-a" uri="https://image.test/pending" />);
  expect(screen.getByTestId('avatar-fallback')).toBeTruthy();
  fireEvent(screen.getByTestId('avatar-image'), 'error');
  expect(screen.getByTestId('avatar-fallback')).toBeTruthy();
  expect(screen.queryByTestId('avatar-image')).toBeNull();
});

test.each([Avatar, CircleAvatar, GroupChatAvatar])('ignores an old avatar request error after the source changes', (Component) => {
  const view = render(<Component uri="https://image.test/a" size={40} />);
  const failA = screen.getByTestId('avatar-image').props.onError;
  view.rerender(<Component uri="https://image.test/b" size={40} />);
  act(() => failA());
  expect(screen.getByTestId('avatar-image').props.source.uri).toBe('https://image.test/b');
  const failB = screen.getByTestId('avatar-image').props.onError;
  act(() => failB());
  expect(screen.queryByTestId('avatar-image')).toBeNull();
  act(() => failA());
  expect(screen.queryByTestId('avatar-image')).toBeNull();
  view.rerender(<Component uri="https://image.test/c" size={40} />);
  expect(screen.getByTestId('avatar-image').props.source.uri).toBe('https://image.test/c');
});

test.each([Avatar, CircleAvatar, GroupChatAvatar])('reports image readiness after display or an error fallback, ignoring the old source', (Component) => {
  const ready = jest.fn();
  const view = render(<Component uri="https://image.test/a" size={40} onImageReady={ready} />);
  const displayA = screen.getByTestId('avatar-image').props.onDisplay;
  expect(ready).not.toHaveBeenCalled();
  view.rerender(<Component uri="https://image.test/b" size={40} onImageReady={ready} />);
  act(() => displayA());
  expect(ready).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId('avatar-image'), 'display');
  expect(ready).toHaveBeenCalledTimes(1);
  view.rerender(<Component uri="https://image.test/c" size={40} onImageReady={ready} />);
  fireEvent(screen.getByTestId('avatar-image'), 'error');
  expect(ready).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('avatar-image')).toBeNull();
});

test.each([Avatar, CircleAvatar, GroupChatAvatar])('retries a previously failed URI after another source was active', (Component) => {
  const view = render(<Component uri="https://image.test/a" size={40} />);
  act(() => screen.getByTestId('avatar-image').props.onError());
  expect(screen.queryByTestId('avatar-image')).toBeNull();

  view.rerender(<Component uri="https://image.test/b" size={40} />);
  expect(screen.getByTestId('avatar-image').props.source.uri).toBe('https://image.test/b');
  view.rerender(<Component uri="https://image.test/a" size={40} />);

  expect(screen.getByTestId('avatar-image').props.source.uri).toBe('https://image.test/a');
});

// 头像上传不缩图(裁出来常是两三千像素见方)。不开早缩放的话 iOS 先整张解码、显示时再在主线程
// 缩到几十点的头像框里,聊天记录里每个头像划进来都要来一次。早缩放让解码直接按头像框的像素来。
// 用户头像和群头像上传前都裁成正方形,早缩放没有副作用。
test.each([Avatar, GroupChatAvatar])('decodes the photo at the avatar size instead of full resolution', (Component) => {
  render(<Component uri="https://image.test/big" name="x" size={40} />);
  expect(screen.getByTestId('avatar-image').props.enforceEarlyResizing).toBe(true);
});

// 圈子头像选图不裁(靠 cover 铺满藏住非正方形原图)。iOS 的早缩放按长边缩到框的像素,
// cover 再把短边放大回去:3:4 的图放大 1.33 倍、截图两倍多,圆框里明显发糊。
test('circle avatars keep a full decode because their pictures are not cropped square', () => {
  render(<CircleAvatar uri="https://image.test/wide" size={40} />);
  expect(screen.getByTestId('avatar-image').props.enforceEarlyResizing).toBeUndefined();
});
