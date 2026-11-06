import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Switch } from 'react-native';
import NoteSettingsScreen from './NoteSettingsScreen';
import { useNoteCollectPreferencesStore } from '@/features/notes/store/use-note-collect-preferences-store';

jest.mock('@/features/notes/store/use-note-collect-preferences-store', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useNoteCollectPreferencesStore: create((set: (partial: object) => void) => ({
      chooseGroup: true,
      editTitle: true,
      setChooseGroup: (chooseGroup: boolean) => set({ chooseGroup }),
      setEditTitle: (editTitle: boolean) => set({ editTitle }),
    })),
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/menu-row', () => {
  const { Switch: RNSwitch, Text, View } = jest.requireActual('react-native');
  return {
    MenuRow: ({ label, toggleValue, onToggle }: { label: string; toggleValue: boolean; onToggle: (value: boolean) => void }) => (
      <View>
        <Text>{label}</Text>
        <RNSwitch accessibilityLabel={label} value={toggleValue} onValueChange={onToggle} />
      </View>
    ),
  };
});
jest.mock('@/theme', () => ({
  Radius: { lg: 16 },
  Spacing: { sm: 8, md: 12, lg: 16 },
  Typography: { small: {} },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', textSecondary: '#666' } }),
}));

beforeEach(() => {
  useNoteCollectPreferencesStore.setState({ chooseGroup: true, editTitle: true });
});

test('both collect steps start on and reflect the saved preferences', () => {
  render(<NoteSettingsScreen />);
  expect(screen.getByLabelText('选择分组').props.value).toBe(true);
  expect(screen.getByLabelText('编辑标题').props.value).toBe(true);
});

test('turning a switch off saves the preference', () => {
  render(<NoteSettingsScreen />);
  fireEvent(screen.getByLabelText('选择分组'), 'valueChange', false);
  fireEvent(screen.getByLabelText('编辑标题'), 'valueChange', false);
  expect(useNoteCollectPreferencesStore.getState()).toEqual(
    expect.objectContaining({ chooseGroup: false, editTitle: false }),
  );
  expect(screen.UNSAFE_getAllByType(Switch).map((item) => item.props.value)).toEqual([false, false]);
});
