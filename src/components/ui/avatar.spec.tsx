import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Avatar } from './avatar';
import { CircleAvatar } from './circle-avatar';
import { GroupChatAvatar } from './group-chat-avatar';

jest.mock('@/features/profile/membership-frames', () => ({ AVATAR_FRAME_SCALE: 1.6, AVATAR_FRAME_COMPACT_SCALE: 1.2 }));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <View {...props} testID="avatar-image" /> };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('./gradient-cover', () => ({ GradientCover: () => null }));
jest.mock('@/theme', () => ({ Radius: { sm: 8 }, useTheme: () => ({ colors: { surface: '#fff' } }) }));

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
