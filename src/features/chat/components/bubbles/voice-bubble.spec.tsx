import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { VoiceBubble } from './voice-bubble';
import type { ChatMessage } from '@/types';

const mockPlay = jest.fn();
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  useAudioPlayer: () => ({
    play: mockPlay,
    pause: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    addListener: () => ({ remove: jest.fn() }),
  }),
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>{name}</Text>;
  },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('./shared', () => ({ MessageAvatar: () => null, BubbleStatusText: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 16 },
  Typography: { tinyRegular: {}, small: {} },
  useTheme: () => ({
    colors: { sentBubble: '#07f', receivedBubble: '#eee', white: '#fff', text: '#111' },
  }),
}));

const voice = {
  id: 'a1',
  type: 'voice',
  voiceUrl: 'https://media.example.com/a.m4a',
  voiceDuration: 7,
  time: '10:00',
} as unknown as ChatMessage;

beforeEach(() => mockPlay.mockReset());

test('a live voice message shows its duration and plays on tap', async () => {
  render(<VoiceBubble message={voice} outgoing={false} />);
  expect(screen.getByText('7"')).toBeTruthy();
  fireEvent.press(screen.getByRole('button'));
  await Promise.resolve();
  await Promise.resolve();
  expect(mockPlay).toHaveBeenCalled();
});

// 过了保留期:不再是一条点了没反应的灰气泡,而是写明「语音已过期」。
test('an expired voice message says it expired and does not play', () => {
  const onLongPress = jest.fn();
  render(
    <VoiceBubble
      message={{ ...voice, voiceUrl: undefined, mediaExpired: true }}
      outgoing={false}
      onLongPress={onLongPress}
    />,
  );
  expect(screen.getByText('chat.detail.voiceExpired')).toBeTruthy();
  expect(screen.queryByText('play-circle')).toBeNull();
  fireEvent.press(screen.getByTestId('chat-media-expired'));
  expect(mockPlay).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId('chat-media-expired'), 'longPress');
  expect(onLongPress).toHaveBeenCalled();
});
