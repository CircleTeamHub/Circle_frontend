import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SettingsDetailScreen } from './settings-detail';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/themed-switch', () => {
  const { Switch } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ThemedSwitch: Switch };
});
jest.mock('@/theme', () => ({
  Radius: { xl: 18, md: 8 }, Spacing: { sm: 4, md: 8, lg: 16, xl: 24 },
  Typography: { body: {}, caption: {} },
  useTheme: () => ({ colors: { primary: '#00f' } }),
}));

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
