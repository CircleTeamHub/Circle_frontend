import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NoteCard } from '@/features/notes/components/NoteCard';
import { NOTE_RATING_BAD_ICON, NOTE_RATING_GOOD_ICON } from '@/features/notes/components/NoteRatingCounts';
import type { NoteSummary } from '@/features/notes/types';
import { lightColors } from '@/theme/colors';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Image: (props: Record<string, unknown>) => <View testID="note-cover" {...props} /> };
});
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/utils/client-diagnostics', () => ({ logClientDiagnostic: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// 图标渲染成带名字和颜色的节点,好断言「哪个图标、什么颜色」。
jest.mock('@expo/vector-icons', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const icon = ({ name, color }: { name: string; color: string }) => (
    <View testID={`icon:${name}`} accessibilityHint={color} />
  );
  return { Ionicons: icon, MaterialCommunityIcons: icon };
});
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }),
}));

const note: NoteSummary = {
  id: 'note-1', title: '北京大妞', contentPreview: '你就加我微信号发来了', status: 'ACTIVE', available: true, pinned: false,
  groups: [{ id: 'g1', name: '北京' }], cover: { id: 'media', type: 'IMAGE', url: 'cover?sig=a' },
  imageCount: 5, videoCount: 0, mediaCount: 5, showcaseCount: 1,
  createdAt: '2026-11-13T07:56:00Z', updatedAt: '2026-11-13T07:56:00Z',
  goodCount: 3, badCount: 1,
} as NoteSummary;

type Node = ReturnType<typeof screen.getByTestId>;
const isAncestor = (ancestor: Node, node: Node) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent === ancestor) return true;
  return false;
};

test('ratings sit under the cover so the meta line keeps its full width', () => {
  render(<NoteCard note={note} onPress={jest.fn()} />);
  const column = screen.getByTestId('note-card-cover-column-note-1');
  const rating = screen.getByTestId('note-card-rating-note-1');

  expect(isAncestor(column, screen.getByTestId('note-cover'))).toBe(true);
  expect(isAncestor(column, rating)).toBe(true);
  // 封面在上、评价在下,左右居中对齐封面。
  const cover = screen.getByTestId('note-cover');
  expect(column.findAll((n: Node) => n === cover || n === rating)[0]).toBe(cover);
  expect(StyleSheet.flatten(column.props.style).alignItems).toBe('center');

  expect(isAncestor(screen.getByTestId('note-card-meta-note-1'), rating)).toBe(false);
  expect(screen.getByTestId('note-card-rating-note-1-good').props.children).toBe(3);
  expect(screen.getByTestId('note-card-rating-note-1-bad').props.children).toBe(1);
});

test('the good and bad rating icons are coloured, not grey', () => {
  render(<NoteCard note={note} onPress={jest.fn()} />);
  expect(screen.getByTestId(`icon:${NOTE_RATING_GOOD_ICON}`).props.accessibilityHint).toBe(lightColors.ratingGood);
  expect(screen.getByTestId(`icon:${NOTE_RATING_BAD_ICON}`).props.accessibilityHint).toBe(lightColors.ratingBad);
});

test('a card without a cover still shows its ratings under the placeholder', () => {
  render(<NoteCard note={{ ...note, cover: null }} onPress={jest.fn()} />);
  expect(isAncestor(
    screen.getByTestId('note-card-cover-column-note-1'),
    screen.getByTestId('note-card-rating-note-1'),
  )).toBe(true);
});

test('old servers without counts show no rating at all', () => {
  render(<NoteCard note={{ ...note, goodCount: undefined, badCount: undefined }} onPress={jest.fn()} />);
  expect(screen.queryByTestId('note-card-rating-note-1')).toBeNull();
});

test('in selection mode with onSelectPress the circle sits left of the card and only it selects; the card opens the note', () => {
  const onPress = jest.fn();
  const onSelectPress = jest.fn();
  render(<NoteCard note={note} onPress={onPress} onSelectPress={onSelectPress} selectionMode selected={false} />);
  const circle = screen.getByTestId(`note-card-select-${note.id}`);
  expect(circle.props.accessibilityRole).toBe('checkbox');
  // 圆圈在卡片外的最左边:是整行的第一个子节点,不在卡片里面。
  const row = screen.toJSON() as { props: { style: unknown }; children: { props: { testID?: string } }[] };
  expect(row.children[0].props.testID).toBe(`note-card-select-${note.id}`);
  fireEvent.press(circle);
  expect(onSelectPress).toHaveBeenCalledWith(note);
  expect(onPress).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText(note.title));
  expect(onPress).toHaveBeenCalledWith(note);
  expect(onSelectPress).toHaveBeenCalledTimes(1);
});

test('selection mode without onSelectPress keeps the whole card as the toggle (other multi-select lists)', () => {
  const onPress = jest.fn();
  render(<NoteCard note={note} onPress={onPress} selectionMode selected accessibilityRole="button" />);
  expect(screen.queryByTestId(`note-card-select-${note.id}`)).toBeNull();
  const card = screen.getByRole('button');
  expect(card.props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(screen.getByText(note.title));
  expect(onPress).toHaveBeenCalledWith(note);
});

test('the outside circle names its note for screen readers', () => {
  render(<NoteCard note={note} onPress={jest.fn()} onSelectPress={jest.fn()} selectionMode selected />);
  const circle = screen.getByTestId(`note-card-select-${note.id}`);
  expect(circle.props.accessibilityLabel.endsWith(note.title)).toBe(true);
  expect(circle.props.accessibilityState).toEqual({ checked: true });
});
