import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NoteActionsSheet } from './NoteActionsSheet';
import type { NoteSummary } from '@/features/notes/types';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Radius: { full: 999, xl: 20 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { caption: {}, body: {} },
  useTheme: () => ({ colors: { overlay: '#0008', surface: '#fff', surfaceBorder: '#ccc', text: '#111', error: '#f00', divider: '#eee' } }),
}));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View>{children}</View> : null,
  };
});

const baseNote = {
  id: 'n1', title: 'Shop', contentPreview: null, status: 'ACTIVE', available: true, pinned: false,
  groups: [], cover: null, imageCount: 0, videoCount: 0, mediaCount: 0, canEdit: true, ownerId: 'me',
  createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z',
} as unknown as NoteSummary;

function renderSheet(note: NoteSummary) {
  const handlers = { onRateGood: jest.fn(), onRateBad: jest.fn(), onViewBadRatings: jest.fn(), onClose: jest.fn() };
  render(
    <NoteActionsSheet
      note={note}
      currentUserId="me"
      onPin={jest.fn()}
      onEdit={jest.fn()}
      onShare={jest.fn()}
      onUnlist={jest.fn()}
      {...handlers}
    />,
  );
  return handlers;
}

test('a collected copy offers 好评 and 差评 for its source note', () => {
  const copy = { ...baseNote, collectedFrom: { sourceNoteId: 'root-1' } } as unknown as NoteSummary;
  const handlers = renderSheet(copy);

  expect(screen.queryByLabelText('notes.rating.viewBad')).toBeNull();
  fireEvent.press(screen.getByLabelText('notes.rating.actionGood'));
  expect(handlers.onRateGood).toHaveBeenCalledWith(copy);
  fireEvent.press(screen.getByLabelText('notes.rating.actionBad'));
  expect(handlers.onRateBad).toHaveBeenCalledWith(copy);
  // The menu closes itself; the rating flow takes over from there.
  expect(handlers.onClose).toHaveBeenCalledTimes(2);
});

test('my own source note offers 查看差评 instead of rating myself', () => {
  const handlers = renderSheet(baseNote);

  expect(screen.queryByLabelText('notes.rating.actionGood')).toBeNull();
  expect(screen.queryByLabelText('notes.rating.actionBad')).toBeNull();
  fireEvent.press(screen.getByLabelText('notes.rating.viewBad'));
  expect(handlers.onViewBadRatings).toHaveBeenCalledWith(baseNote);
});
