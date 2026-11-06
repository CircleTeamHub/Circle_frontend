import React from 'react';
import { StyleSheet } from 'react-native';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SettingsDetailScreen, type SettingsDetailSection } from './settings-detail';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`icon:${name}`}</Text>;
  },
}));
jest.mock('@/theme', () => {
  const tokens = jest.requireActual('@/theme/tokens');
  return {
    ...tokens,
    useTheme: () => ({
      resolvedMode: 'light',
      colors: {
        background: '#f4f5f8', surface: '#fff', surfaceBorder: '#ddd', divider: '#eee', text: '#111',
        textSecondary: '#666', error: '#e5484d', success: '#22c55e', primary: '#6366f1', primaryLight: '#eef',
      },
    }),
  };
});

function renderSections(sections: SettingsDetailSection[]) {
  return render(<SettingsDetailScreen titleKey="title" sections={sections} testIDPrefix="spec" />);
}

test('tapping anywhere on a toggle row flips it, and a disabled toggle row stays put', () => {
  const onPush = jest.fn();
  const onLocked = jest.fn();
  renderSections([{
    rows: [
      { id: 'push', labelKey: 'push', type: 'toggle', value: true, onValueChange: onPush },
      { id: 'locked', labelKey: 'locked', type: 'toggle', value: false, onValueChange: onLocked, disabled: true },
    ],
  }]);

  fireEvent.press(screen.getByText('push'));
  expect(onPush).toHaveBeenCalledWith(false);
  fireEvent.press(screen.getByText('locked'));
  expect(onLocked).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: 'push' })).toBeTruthy();
  expect(screen.getAllByRole('switch')).toHaveLength(2);
});

test('destructive action rows drop the chevron while navigation rows keep it', () => {
  renderSections([{
    rows: [
      { id: 'open', labelKey: 'open', onPress: jest.fn() },
      { id: 'wipe', labelKey: 'wipe', destructive: true, onPress: jest.fn() },
      { id: 'size', labelKey: 'size', type: 'info', valueText: '3 MB' },
    ],
  }]);

  expect(screen.getAllByText('icon:chevron-forward')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'open' })).toBeTruthy();
  expect(screen.getByText('3 MB')).toBeTruthy();
});

test('a section can carry a footnote under its card', () => {
  renderSections([{ titleKey: 'section', footerKey: 'section.hint', rows: [{ id: 'a', labelKey: 'a', type: 'info' }] }]);
  expect(screen.getByText('section')).toBeTruthy();
  expect(screen.getByText('section.hint')).toBeTruthy();
});

test('a row can override its test id so callers keep their e2e locators', () => {
  renderSections([{ rows: [{ id: 'profile', labelKey: 'profile', testID: 'custom.row', onPress: jest.fn() }] }]);
  expect(screen.getByTestId('custom.row')).toBeTruthy();
});

test('assistive names retain visible setting values, permission status and row context', () => {
  renderSections([{
    rows: [
      { id: 'size', labelKey: 'size', type: 'info', valueText: '3 MB' },
      { id: 'permission', labelKey: 'camera', statusKey: 'authorized', onPress: jest.fn() },
      { id: 'result', labelKey: 'vibration', subtitleKey: 'notifications', onPress: jest.fn() },
    ],
  }]);

  expect(screen.getByLabelText('size, 3 MB')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'camera, authorized' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'vibration, notifications' })).toBeTruthy();
});

test('a controlled toggle label changes its value once, and switch changes do not trigger the label', () => {
  const onChange = jest.fn();
  render(<SettingsDetailScreen titleKey="settings" sections={[{ rows: [{
    id: 'privacy', labelKey: 'Share presence', type: 'toggle', value: true, onValueChange: onChange,
  }] }]} />);
  fireEvent.press(screen.getByText('Share presence'));
  expect(onChange.mock.calls).toEqual([[false]]);
  onChange.mockClear();
  fireEvent(screen.getByRole('switch'), 'valueChange', false);
  expect(onChange.mock.calls).toEqual([[false]]);
});

test('disabled controlled toggles ignore label presses', () => {
  const onChange = jest.fn();
  render(<SettingsDetailScreen titleKey="settings" sections={[{ rows: [{
    id: 'privacy', labelKey: 'Share presence', type: 'toggle', value: true, onValueChange: onChange, disabled: true,
  }] }]} />);
  fireEvent.press(screen.getByText('Share presence'));
  expect(onChange).not.toHaveBeenCalled();
});

test('link labels keep their existing navigation behavior', () => {
  const onPress = jest.fn();
  render(<SettingsDetailScreen titleKey="settings" sections={[{ rows: [{
    id: 'link', labelKey: 'Blacklist', onPress,
  }] }]} />);
  fireEvent.press(screen.getByText('Blacklist'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('pages can lock controls without changing the opacity of every row', () => {
  render(<SettingsDetailScreen titleKey="settings" testIDPrefix="privacy" dimDisabledRows={false} sections={[{ rows: [{
    id: 'privacy', labelKey: 'Share presence', type: 'toggle', value: true, onValueChange: jest.fn(), disabled: true,
  }] }]} />);
  const row = screen.getByTestId(E2E_TEST_IDS.settingsDetailRow('privacy.privacy'));
  expect(StyleSheet.flatten(row.props.style)?.opacity).toBeUndefined();
});
