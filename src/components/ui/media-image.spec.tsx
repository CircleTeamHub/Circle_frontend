import React from 'react';
import { ActivityIndicator, Animated, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { MEDIA_PROGRESS_DELAY_MS, MediaImage } from './media-image';

let mockImageRenders = 0;
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: (props: object) => {
      mockImageRenders += 1;
      return <View {...props} />;
    },
  };
});

beforeEach(() => {
  jest.useFakeTimers();
  mockImageRenders = 0;
});
afterEach(() => jest.useRealTimers());

const showDelayedProgress = () => act(() => {
  jest.advanceTimersByTime(MEDIA_PROGRESS_DELAY_MS);
});

test('shows real download progress in the image and removes it when displayed', () => {
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} style={{ width: 200, height: 150 }} />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  // 还在等:缓存里的图通常这段时间内就显示了,不为它挂进度条。
  expect(screen.queryByRole('progressbar')).toBeNull();
  showDelayedProgress();
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBeUndefined();
  expect(screen.getByTestId('media-progress-track')).toBeTruthy();
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 25, total: 100 });
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 100, now: 25 });
  expect(screen.getByText('25%')).toBeTruthy();
  fireEvent(screen.getByTestId('photo'), 'display');
  expect(screen.queryByRole('progressbar')).toBeNull();
});

// 滑动聊天记录时每一张划进来的图都会先发 loadStart:缓存命中的图马上就显示,
// 不能为它挂一次进度遮罩、起一次循环动画、多渲染两遍。
test('a load that finishes within the delay never mounts the overlay or re-renders', () => {
  const loop = jest.spyOn(Animated, 'loop');
  try {
    render(<MediaImage testID="photo" source={{ uri: 'https://image.test/cached' }} />);
    const rendersAfterMount = mockImageRenders;
    fireEvent(screen.getByTestId('photo'), 'loadStart');
    fireEvent(screen.getByTestId('photo'), 'display');
    showDelayedProgress();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(loop).not.toHaveBeenCalled();
    expect(mockImageRenders).toBe(rendersAfterMount);
  } finally {
    loop.mockRestore();
  }
});

test('byte progress re-renders only when the whole percentage changes', () => {
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} />);
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  showDelayedProgress();
  fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 2510, total: 10000 });
  const renders = mockImageRenders;
  fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 2540, total: 10000 });
  fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 2590, total: 10000 });
  expect(mockImageRenders).toBe(renders);
  fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 2600, total: 10000 });
  expect(screen.getByText('26%')).toBeTruthy();
});

test('progress that arrived during the delay is what the overlay first shows', () => {
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} />);
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 40, total: 100 });
  expect(screen.queryByRole('progressbar')).toBeNull();
  showDelayedProgress();
  expect(screen.getByText('40%')).toBeTruthy();
});

test('clears failed download progress and preserves caller error handling and privacy policy', () => {
  const onError = jest.fn();
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/private' }} cachePolicy="memory" onError={onError} />);
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  showDelayedProgress();
  fireEvent(screen.getByTestId('photo'), 'error', { error: 'offline' });
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(onError).toHaveBeenCalledWith({ error: 'offline' });
  expect(screen.getByTestId('photo').props.cachePolicy).toBe('memory');
});

test('keeps normal media in memory and disk without a fade on every entry', () => {
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} />);
  expect(screen.getByTestId('photo').props.cachePolicy).toBe('memory-disk');
  expect(screen.getByTestId('photo').props.transition).toBe(0);
});

test('ends progress when loading completes even without a second display event on reentry', () => {
  const onLoadEnd = jest.fn();
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} onLoadEnd={onLoadEnd} />);
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  showDelayedProgress();
  fireEvent(screen.getByTestId('photo'), 'loadEnd');
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(onLoadEnd).toHaveBeenCalledTimes(1);
});

test('stops the moving bar when byte progress arrives or the image unmounts', () => {
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  try {
    const view = render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} />);
    fireEvent(screen.getByTestId('photo'), 'loadStart');
    showDelayedProgress();
    fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 25, total: 100 });
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByTestId('photo'), 'loadStart');
    showDelayedProgress();
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  } finally {
    loop.mockRestore();
  }
});

test('unmounting while waiting to show progress leaves no timer behind', () => {
  const view = render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} />);
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

// 视频封面要把播放按钮画在图上、进度遮罩下:下载中进度盖住播放键,显示后播放键露出来。
test('an overlay draws above the image and below the progress badge', () => {
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/poster' }} overlay={<Text>play</Text>} />);
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  showDelayedProgress();
  const frame = screen.toJSON() as { children: { type: string; props: { testID?: string; accessibilityRole?: string } }[] };
  const order = frame.children.map((child) => child.props.testID ?? child.props.accessibilityRole ?? child.type);
  expect(order).toEqual(['photo', 'Text', 'progressbar']);
});
