import React from 'react';
import { View as MockView } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MediaSourceSheet } from './media-source-sheet';

const mockSheetProps = jest.fn();
jest.mock('@/components/ui/bottom-sheet-modal', () => ({
  BottomSheetModal: (props: { visible: boolean; children: React.ReactNode; onDismiss?: () => void }) => {
    mockSheetProps(props);
    return props.visible ? <MockView>{props.children}</MockView> : null;
  },
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  Radius: { xxl: 28, full: 999 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { body: {} },
  useTheme: () => ({
    colors: { overlay: '#0008', surface: '#fff', surfaceBorder: '#ddd', text: '#000', error: '#f00', inputBg: '#eee' },
  }),
}));

beforeEach(() => mockSheetProps.mockClear());

it('lists album, camera and edit & send in the reference order, then cancel', () => {
  render(<MediaSourceSheet visible onSelect={jest.fn()} onClose={jest.fn()} />);
  const labels = screen.getAllByRole('button').map((button) => button.props.accessibilityLabel);
  expect(labels).toEqual([
    'chat.attachments.mediaAlbum',
    'chat.attachments.camera',
    'chat.attachments.editAndSend',
    'common.cancel',
  ]);
});

it.each([
  ['chat.attachments.mediaAlbum', 'album'],
  ['chat.attachments.camera', 'camera'],
  ['chat.attachments.editAndSend', 'edit'],
] as const)('pressing %s selects %s', (label, action) => {
  const select = jest.fn();
  render(<MediaSourceSheet visible onSelect={select} onClose={jest.fn()} />);
  fireEvent.press(screen.getByLabelText(label));
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(action);
});

it('cancel closes the sheet without choosing a source and forwards the iOS dismiss callback', () => {
  const select = jest.fn();
  const close = jest.fn();
  const dismiss = jest.fn();
  render(<MediaSourceSheet visible onSelect={select} onClose={close} onDismiss={dismiss} />);
  fireEvent.press(screen.getByLabelText('common.cancel'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  expect(mockSheetProps).toHaveBeenLastCalledWith(expect.objectContaining({ onDismiss: dismiss }));
});
