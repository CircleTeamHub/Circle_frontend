import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { NoteMediaUploadRing } from './NoteMediaUploadRing';
import { resetUploadProgress, startUploadProgress } from '@/stores/upload-progress-store';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View, Circle: View };
});

afterEach(() => act(() => resetUploadProgress()));

test('shows this tile’s own upload percentage', () => {
  let progress!: ReturnType<typeof startUploadProgress>;
  act(() => {
    progress = startUploadProgress('image/jpeg', { progressKey: 'tile-a' });
    startUploadProgress('image/jpeg', { progressKey: 'tile-b' }).update(90, 100);
  });
  render(<NoteMediaUploadRing progressKey="tile-a" />);
  expect(screen.getByText('0%')).toBeTruthy();
  act(() => progress.update(42, 100));
  expect(screen.getByText('42%')).toBeTruthy();
});

test('all bytes handed to the system shows 99%, never a separate confirming stage', () => {
  act(() => { startUploadProgress('image/jpeg', { progressKey: 'tile-a' }).update(100, 100); });
  render(<NoteMediaUploadRing progressKey="tile-a" />);
  expect(screen.getByText('99%')).toBeTruthy();
  expect(screen.queryByText(/confirming/)).toBeNull();
});
