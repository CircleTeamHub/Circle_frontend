import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Switch } from 'react-native';
import NoteSettingsScreen from './NoteSettingsScreen';
import { useNoteCollectPreferencesStore } from '@/features/notes/store/use-note-collect-preferences-store';

let mockUserId: string | null = 'user-a';
jest.mock('@/storage', () => {
  const values = new Map<string, string>();
  return {
    mmkvJsonStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  };
});
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: mockUserId ? { id: mockUserId } : null }),
}));
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
  mockUserId = 'user-a';
  useNoteCollectPreferencesStore.setState({ byUser: {} });
});

test('both collect steps start on and reflect the saved preferences', () => {
  render(<NoteSettingsScreen />);
  expect(screen.getByLabelText('选择分组').props.value).toBe(true);
  expect(screen.getByLabelText('编辑标题').props.value).toBe(true);
});

test('turning a switch off saves the preference for the signed-in account only', () => {
  const view = render(<NoteSettingsScreen />);
  fireEvent(screen.getByLabelText('选择分组'), 'valueChange', false);
  fireEvent(screen.getByLabelText('编辑标题'), 'valueChange', false);
  expect(useNoteCollectPreferencesStore.getState().byUser['user-a']).toEqual({
    chooseGroup: false,
    editTitle: false,
  });
  expect(screen.UNSAFE_getAllByType(Switch).map((item) => item.props.value)).toEqual([false, false]);

  // 同一台手机切到另一个账号:仍是默认的两步确认。
  mockUserId = 'user-b';
  view.rerender(<NoteSettingsScreen />);
  expect(screen.UNSAFE_getAllByType(Switch).map((item) => item.props.value)).toEqual([true, true]);
});
