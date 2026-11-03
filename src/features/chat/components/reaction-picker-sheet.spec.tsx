import React from 'react';
import { View as MockView } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReactionPickerSheet } from './reaction-picker-sheet';
import { EMOJI_GROUPS } from '@/constants/emojis';

jest.mock('@/components/ui/bottom-sheet-modal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <MockView>{children}</MockView> : null,
}));
// Custom stickers stay disabled for reactions; isolate their native session storage.
jest.mock('@/services/api/upload', () => ({}));
jest.mock('@/features/chat/utils/sticker-error', () => ({}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: () => 1 }));
jest.mock('@/features/chat/store/use-sticker-store', () => ({
  useStickerStore: () => ({ items: [], loading: false, error: false, refresh: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  Radius: { xl: 24, full: 999 }, Spacing: { sm: 8, md: 12, lg: 16 },
  Typography: { h3: {}, small: {} },
  useTheme: () => ({ colors: { background: '#000', surfaceBorder: '#333', text: '#fff' } }),
}));

it('offers every chat emoji in the reaction picker, including all six legacy reactions', () => {
  render(<ReactionPickerSheet visible onSelect={jest.fn()} onClose={jest.fn()} />);
  for (const emoji of EMOJI_GROUPS.flatMap((group) => group.emojis)) {
    expect(screen.getByLabelText(emoji)).toBeTruthy();
  }
  for (const emoji of ['👍', '❤️', '😂', '😮', '😢', '🙏']) {
    expect(screen.getByLabelText(emoji)).toBeTruthy();
  }
});

it.each(['🤔', '✌️', '❤️', '🐼', '🍕', '🚀'])('selects %s once', (emoji) => {
  const select = jest.fn();
  render(<ReactionPickerSheet visible onSelect={select} onClose={jest.fn()} />);
  fireEvent.press(screen.getByLabelText(emoji));
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(emoji);
});

it('closing does not send a reaction, and the hidden sheet renders no emoji cells', () => {
  const select = jest.fn();
  const close = jest.fn();
  const view = render(<ReactionPickerSheet visible onSelect={select} onClose={close} />);
  fireEvent.press(screen.getByLabelText('common.close'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  view.rerender(<ReactionPickerSheet visible={false} onSelect={select} onClose={close} />);
  expect(screen.queryByLabelText('👍')).toBeNull();
});
