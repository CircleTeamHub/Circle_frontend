import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { CollectionContentPreview } from './CollectionContentPreview';
import type { CollectionContent } from '../collection-content';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const en = jest.requireActual('@/i18n/locales/en.json');
      return key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], en)
        ?? options?.defaultValue ?? key;
    },
  }),
}));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: object) => <View {...props} /> };
});
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: jest.fn(() => null) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Avatar: (props: object) => <View testID="contact-avatar" {...props} /> };
});
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: {
    text: '#111111', textSecondary: '#666666', primary: '#7254EE',
    surface: '#FFFFFF', surfaceBorder: '#DDDDDD', background: '#F3F3F3',
    white: '#FFFFFF', black: '#000000',
  } }),
}));

const content = (value: Partial<CollectionContent>): CollectionContent => ({
  message: null, kind: 'text', text: '', ...value,
});

test('renders the actual text once with a readable five-line preview', () => {
  render(<CollectionContentPreview content={content({ text: 'A real saved message, with its original words.' })} />);
  expect(screen.getAllByText('A real saved message, with its original words.')).toHaveLength(1);
  expect(screen.getByText('A real saved message, with its original words.').props.numberOfLines).toBe(5);
  expect(screen.getByTestId('collection-content-preview').props.pointerEvents).toBe('none');
});

test('shows the saved image in a bounded contain preview', () => {
  render(<CollectionContentPreview content={content({
    kind: 'image', imageUri: 'https://cdn.example.com/image.jpg', width: 800, height: 1200,
  })} />);
  const image = screen.getByTestId('collection-preview-image');
  expect(image.props.source).toEqual({ uri: 'https://cdn.example.com/image.jpg' });
  expect(image.props.contentFit).toBe('contain');
  const stage = StyleSheet.flatten(screen.getByTestId('collection-preview-media').props.style);
  expect(stage.maxWidth).toBeLessThanOrEqual(400);
  expect(stage.height).toBeLessThanOrEqual(240);
});

test('shows a video poster and duration without creating a video player', () => {
  render(<CollectionContentPreview content={content({
    kind: 'video', videoUri: 'https://cdn.example.com/video.mp4',
    posterUri: 'https://cdn.example.com/poster.jpg', duration: 75,
  })} />);
  expect(screen.getByTestId('collection-preview-image').props.source).toEqual({ uri: 'https://cdn.example.com/poster.jpg' });
  expect(screen.getByText('1:15')).toBeTruthy();
  expect(screen.getByTestId('collection-preview-play')).toBeTruthy();
  expect(useVideoPlayer).not.toHaveBeenCalled();
});

test('keeps playable videos recognizable when they have no poster', () => {
  render(<CollectionContentPreview content={content({ kind: 'video', videoUri: 'https://cdn.example.com/video.mp4' })} />);
  expect(screen.getByTestId('collection-preview-play')).toBeTruthy();
  expect(screen.queryByText('Content unavailable')).toBeNull();
});

test('shows voice duration and the parent-provided playback state', () => {
  render(<CollectionContentPreview playing content={content({ kind: 'voice', voiceUri: 'https://cdn.example.com/voice.m4a', duration: 12 })} />);
  expect(screen.getByText('Voice message')).toBeTruthy();
  expect(screen.getByText('0:12')).toBeTruthy();
  expect(screen.getByText('Playing')).toBeTruthy();
});

test('shows the actual contact name and avatar', () => {
  render(<CollectionContentPreview content={content({
    kind: 'friend-card', message: {
      id: 'friend-card', type: 'friend-card',
      friendCard: { userID: 'friend', nickname: 'Rina', faceURL: 'https://cdn.example.com/avatar.jpg', persona: 'Cycling and coffee' },
    },
  })} />);
  expect(screen.getByText('Rina')).toBeTruthy();
  expect(screen.getByTestId('contact-avatar').props.uri).toBe('https://cdn.example.com/avatar.jpg');
  expect(screen.getByText('Cycling and coffee')).toBeTruthy();
});

test('shows the actual location title and address', () => {
  render(<CollectionContentPreview content={content({
    kind: 'location', message: {
      id: 'location', type: 'location', locationTitle: 'Central Park', locationAddress: 'New York, NY',
    },
  })} />);
  expect(screen.getByText('Central Park')).toBeTruthy();
  expect(screen.getByText('New York, NY')).toBeTruthy();
});

test('shows the amount and note of a saved transfer receipt', () => {
  render(<CollectionContentPreview content={content({ kind: 'transfer-card', text: '125 Credits',
    message: { id: 'transfer', type: 'transfer-card', transferCard: { amount: 125, message: 'Lunch' } },
  })} />);
  expect(screen.getByText('Coin Transfer')).toBeTruthy();
  expect(screen.getByText('125 Credits')).toBeTruthy();
  expect(screen.getByText('Lunch')).toBeTruthy();
  expect(screen.queryByText('Content unavailable')).toBeNull();
});

test('keeps a saved transfer summary readable when no source receipt is available', () => {
  render(<CollectionContentPreview content={content({ kind: 'transfer-card', text: '125 Credits' })} />);
  expect(screen.getByText('125 Credits')).toBeTruthy();
  expect(screen.queryByText('Content unavailable')).toBeNull();
});

test.each([
  content({ kind: 'other', text: '[Unrecognized attachment]' }),
  content({ kind: 'image' }),
  content({ kind: 'video' }),
  content({ kind: 'voice' }),
  content({ kind: 'text' }),
])('shows a clear unavailable fallback for unsupported or absent content %#', (value) => {
  render(<CollectionContentPreview content={value} />);
  expect(screen.getByText('Content unavailable')).toBeTruthy();
});

test('recovers from an image error when a fresh source arrives', () => {
  const original = content({ kind: 'image', imageUri: 'https://cdn.example.com/old.jpg' });
  const { rerender } = render(<CollectionContentPreview content={original} />);
  fireEvent(screen.getByTestId('collection-preview-image'), 'error');
  expect(screen.getByText('Content unavailable')).toBeTruthy();
  rerender(<CollectionContentPreview content={content({ kind: 'image', imageUri: 'https://cdn.example.com/fresh.jpg' })} />);
  expect(screen.queryByText('Content unavailable')).toBeNull();
  expect(screen.getByTestId('collection-preview-image').props.source.uri).toBe('https://cdn.example.com/fresh.jpg');
});

test.each(['zh', 'en', 'es', 'ja', 'ko'])('keeps collection action strings and interpolation names aligned in %s', (locale) => {
  const strings = jest.requireActual(`@/i18n/locales/${locale}.json`).profile.collections;
  const expectedParameters: Record<string, string[]> = {
    longPressHint: [], unavailable: [], textPreviewTitle: [],
    selectedCount: ['count'], selectAll: [], deselectAll: [],
    batchDeleteConfirm: ['count'], batchDeleteResult: ['failed', 'succeeded'],
    batchSaveResult: ['failed', 'skipped', 'succeeded'], operationProgress: ['current', 'total'],
    saveDenied: [], unsupportedForward: [], imagePreviewLabel: [], videoPreviewLabel: [],
    voicePreviewLabel: [], voicePlayingLabel: [],
  };
  for (const [key, parameters] of Object.entries(expectedParameters)) {
    expect(typeof strings[key]).toBe('string');
    expect(strings[key].length).toBeGreaterThan(0);
    expect([...strings[key].matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()).toEqual(parameters);
  }
});
