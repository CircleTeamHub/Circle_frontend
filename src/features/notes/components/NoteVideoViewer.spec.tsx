import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NoteVideoViewer } from './NoteVideoViewer';

// The player itself (loading, retry, error reporting, bottom control bar) is covered by
// viewer-video-page.spec; here we check the note viewer hosts it the right way.
let mockPageProps: Record<string, unknown> & { onSwipeDown: () => void };
const mockPageUnmounted = jest.fn();
jest.mock('@/components/ui/viewer-video-page', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ViewerVideoPage: (props: Record<string, unknown> & { onSwipeDown: () => void }) => {
      mockPageProps = props;
      useEffect(() => () => mockPageUnmounted(), []);
      return <View testID="note-video-player" />;
    },
  };
});
jest.mock('@/components/app/UploadProgressHost', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { UploadProgressHost: () => <View testID="upload-progress-modal-host" /> };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
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
}));

const uri = 'https://private.example.com/note.mp4?signature=secret';

function ViewerHost() {
  const [open, setOpen] = useState(true);
  return open ? <NoteVideoViewer uri={uri} onClose={() => setOpen(false)} /> : null;
}

beforeEach(() => jest.clearAllMocks());

test('plays in the shared full-screen player with its controls at the bottom', () => {
  const onMediaError = jest.fn();
  render(<NoteVideoViewer uri={uri} onClose={jest.fn()} onMediaError={onMediaError} />);

  expect(mockPageProps).toMatchObject({ videoUrl: uri, ephemeral: false, autoPlay: true });
  // Expired signed URLs are refreshed by the note when the player reports a failure.
  expect(mockPageProps.onMediaError).toBe(onMediaError);
  expect(screen.UNSAFE_getByType(Modal).props).toMatchObject({
    visible: true,
    presentationStyle: 'fullScreen',
    statusBarTranslucent: true,
  });
  expect(screen.UNSAFE_getByType(StatusBar).props.style).toBe('light');
  expect(StyleSheet.flatten(screen.getByLabelText('common.close').props.style).top).toBe(32);
});

test.each(['button', 'android back', 'swipe down'])('%s dismisses the viewer and unmounts the player', (action) => {
  render(<ViewerHost />);

  if (action === 'button') {
    fireEvent.press(screen.getByLabelText('common.close'));
  } else if (action === 'android back') {
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
  } else {
    act(() => mockPageProps.onSwipeDown());
  }

  expect(screen.queryByTestId('note-video-player')).toBeNull();
  expect(mockPageUnmounted).toHaveBeenCalledTimes(1);
});

test('keeps upload progress visible inside its existing native modal', () => {
  render(<NoteVideoViewer uri={uri} onClose={jest.fn()} />);
  expect(screen.getByTestId('upload-progress-modal-host')).toBeTruthy();
});
