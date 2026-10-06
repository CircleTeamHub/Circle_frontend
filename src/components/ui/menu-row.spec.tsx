import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { MenuRow } from './menu-row';

jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: Object.assign(
      ({ name }: { name: string }) => <Text>{name}</Text>,
      { glyphMap: { 'person-add': 1, 'chevron-forward': 1 } },
    ),
  };
});

jest.mock('@/theme', () => ({
  Spacing: { md: 8, sm: 8 },
  Typography: {
    body: { fontSize: 16 },
    small: { fontSize: 12 },
    caption: { fontSize: 11 },
  },
  useTheme: () => ({
    colors: {
      text: '#111',
      textSecondary: '#666',
      error: '#d33',
      dangerFill: '#b22',
      badgeUnread: '#b22',
      white: '#fff',
      switchOffTrack: '#ccc',
      primary: '#45f',
    },
  }),
}));

jest.mock('./icon-circle', () => ({
  IconCircle: () => null,
}));

jest.mock('./themed-switch', () => ({
  ThemedSwitch: () => null,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, { count }: { count: number }) => `${count} unread`,
  }),
}));

test.each([
  [0, null],
  [1, '1'],
  [99, '99'],
  [100, '99+'],
])('renders unread count %s as %s and exposes it to assistive tech', (count, display) => {
  render(
    <MenuRow
      testID="menu-row"
      icon="person-add"
      label="New friends"
      badgeCount={count}
      showArrow={false}
    />,
  );

  const row = screen.getByTestId('menu-row');
  expect(row.props.accessibilityLabel).toBe(
    count > 0 ? `New friends, ${count} unread` : 'New friends',
  );
  if (display) {
    expect(screen.getByText(display, { includeHiddenElements: true })).toBeTruthy();
  } else {
    expect(screen.queryByText('0', { includeHiddenElements: true })).toBeNull();
  }
});

test('keeps the legacy boolean indicator as a numeric one', () => {
  render(
    <MenuRow
      testID="menu-row"
      icon="person-add"
      label="New friends"
      showIndicatorDot
      showArrow={false}
    />,
  );

  expect(screen.getByText('1', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('menu-row').props.accessibilityLabel).toBe('New friends, 1 unread');
});
