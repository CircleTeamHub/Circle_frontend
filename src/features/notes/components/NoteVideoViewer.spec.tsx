import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActivityIndicator, Modal, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { reportHandledFailure } from '@/observability/report-failure';
import { NoteVideoViewer } from './NoteVideoViewer';

const mockPlayer = {
  replaceAsync: jest.fn(() => Promise.resolve()),
  play: jest.fn(),
  addListener: jest.fn(),
};
const mockRelease = jest.fn();
const mockRemoveListener = jest.fn();
const mockUseVideoPlayer = jest.fn();
let mockVideoViewMounted = false;
let mockVideoViewProps: Record<string, unknown>;
let mockStatusListener: (event: { status: string; error?: unknown }) => void;

jest.mock('expo-video', () => {
  const { useEffect, useLayoutEffect } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useVideoPlayer: (source: unknown) => {
      mockUseVideoPlayer(source);
      useEffect(() => () => mockRelease(), []);
      return mockPlayer;
    },
    VideoView: (props: Record<string, unknown>) => {
      mockVideoViewProps = props;
      useLayoutEffect(() => {
        mockVideoViewMounted = true;
        return () => { mockVideoViewMounted = false; };
      }, []);
      return <View testID="note-video-player" />;
    },
  };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme', () => ({
  Radius: { full: 999 },
  Spacing: { sm: 8, md: 16, lg: 24 },
  Typography: { body: {} },
}));

const uri = 'https://private.example.com/note.mp4?signature=secret';

function ViewerHost() {
  const [open, setOpen] = useState(true);
  return open ? <NoteVideoViewer uri={uri} onClose={() => setOpen(false)} /> : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVideoViewMounted = false;
  mockPlayer.replaceAsync.mockReset().mockResolvedValue(undefined);
  mockPlayer.addListener.mockImplementation((_event, listener) => {
    mockStatusListener = listener;
    return { remove: mockRemoveListener };
  });
});

test('mounts the native view before loading and plays the selected video', async () => {
  let resolve!: () => void;
  mockPlayer.replaceAsync.mockImplementationOnce(() => {
    expect(mockVideoViewMounted).toBe(true);
    return new Promise<void>((done) => { resolve = done; });
  });
  render(<NoteVideoViewer uri={uri} onClose={jest.fn()} />);

  expect(mockUseVideoPlayer).toHaveBeenCalledWith(null);
  expect(mockPlayer.replaceAsync).toHaveBeenCalledWith(uri);
  expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  expect(mockVideoViewProps).toMatchObject({
    player: mockPlayer,
    nativeControls: true,
    contentFit: 'contain',
    surfaceType: 'textureView',
  });
  expect(screen.UNSAFE_getByType(Modal).props).toMatchObject({
    visible: true,
    presentationStyle: 'fullScreen',
    statusBarTranslucent: true,
  });
  expect(screen.UNSAFE_getByType(StatusBar).props.style).toBe('light');
  expect(StyleSheet.flatten(screen.getByLabelText('common.close').props.style).top).toBe(32);

  await act(async () => resolve());
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
});

test.each(['button', 'android back'])('%s dismisses the viewer and releases its player', async (action) => {
  render(<ViewerHost />);
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));

  if (action === 'button') {
    fireEvent.press(screen.getByLabelText('common.close'));
  } else {
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
  }

  expect(screen.queryByTestId('note-video-player')).toBeNull();
  expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

test('closing during loading prevents a late completion from starting playback', async () => {
  let resolve!: () => void;
  mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  render(<ViewerHost />);
  fireEvent.press(screen.getByLabelText('common.close'));

  await act(async () => resolve());

  expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

test('a load failure shows retry and reports no private URL or native error', async () => {
  mockPlayer.replaceAsync.mockRejectedValueOnce(new Error(`Failed to load ${uri}`));
  render(<NoteVideoViewer uri={uri} onClose={jest.fn()} />);

  await waitFor(() => expect(screen.getByText('chat.detail.videoUnavailable')).toBeTruthy());
  expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(reportHandledFailure).toHaveBeenCalledWith('noteEditor', 'videoLoad', new Error('Video load failed'));

  fireEvent.press(screen.getByLabelText('common.retry'));
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));

  expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('chat.detail.videoUnavailable')).toBeNull();
  expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  expect(mockRelease).not.toHaveBeenCalled();
});

test('a playback error exposes retry and reports only a generic error', async () => {
  render(<NoteVideoViewer uri={uri} onClose={jest.fn()} />);
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));

  act(() => mockStatusListener({ status: 'error', error: { message: `Decoder failed for ${uri}` } }));

  expect(screen.getByLabelText('common.retry')).toBeTruthy();
  expect(reportHandledFailure).toHaveBeenCalledWith('noteEditor', 'videoPlayback', new Error('Video playback failed'));
  fireEvent.press(screen.getByLabelText('common.retry'));
  await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('chat.detail.videoUnavailable')).toBeNull();
});

test('unmounting ignores late load failures and removes the status listener', async () => {
  let reject!: (error: Error) => void;
  mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const view = render(<NoteVideoViewer uri={uri} onClose={jest.fn()} />);
  view.unmount();

  await act(async () => reject(new Error(`Failed to load ${uri}`)));
  act(() => mockStatusListener({ status: 'error' }));

  expect(reportHandledFailure).not.toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
