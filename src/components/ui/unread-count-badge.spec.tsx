import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { UnreadCountBadge } from './unread-count-badge';

jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: { badgeUnread: '#C62828', white: '#FFFFFF' } }),
}));

afterEach(() => jest.restoreAllMocks());

test.each([
  [1, 16],
  [1.8, 28],
  [3, 30],
])('expands the unread badge at font scale %s without clipping', (fontScale, size) => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(native, 'useWindowDimensions').mockReturnValue({
    width: 390,
    height: 844,
    scale: 3,
    fontScale,
  });

  render(<UnreadCountBadge count={99} testID="unread-badge" />);

  const badge = screen.getByTestId('unread-badge', { includeHiddenElements: true });
  const style = StyleSheet.flatten(badge.props.style);
  expect(style.minWidth).toBe(size);
  expect(style.minHeight).toBe(size);
  expect(style.height).toBeUndefined();
  expect(style.backgroundColor).toBe('#C62828');
  expect(screen.getByText('99', { includeHiddenElements: true }).props.maxFontSizeMultiplier).toBe(2);
});
