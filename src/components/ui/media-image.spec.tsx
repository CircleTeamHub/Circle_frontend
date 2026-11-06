import React from 'react';
import { ActivityIndicator, Animated } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MediaImage } from './media-image';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <View {...props} /> };
});

test('shows real download progress in the image and removes it when displayed', () => {
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/photo' }} style={{ width: 200, height: 150 }} />);
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent(screen.getByTestId('photo'), 'loadStart');
  expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBeUndefined();
  expect(screen.getByTestId('media-progress-track')).toBeTruthy();
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 25, total: 100 });
  expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 100, now: 25 });
  expect(screen.getByText('25%')).toBeTruthy();
  fireEvent(screen.getByTestId('photo'), 'display');
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('clears failed download progress and preserves caller error handling and privacy policy', () => {
  const onError = jest.fn();
  render(<MediaImage testID="photo" source={{ uri: 'https://image.test/private' }} cachePolicy="memory" onError={onError} />);
  fireEvent(screen.getByTestId('photo'), 'loadStart');
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
    fireEvent(screen.getByTestId('photo'), 'progress', { loaded: 25, total: 100 });
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByTestId('photo'), 'loadStart');
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  } finally {
    loop.mockRestore();
  }
});
