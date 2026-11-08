import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import CirclePlazaScreen from './CirclePlazaScreen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/features/discover/components/plaza-feed', () => ({ PlazaFeed: () => null }));
jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: (select: (state: { circleUnread: number; signupUnread: number }) => number) =>
    select({ circleUnread: 0, signupUnread: 0 }),
}));

beforeEach(() => mockPush.mockClear());

test('the circle feed header opens circle notification settings', () => {
  render(<CirclePlazaScreen />);
  fireEvent.press(screen.getByLabelText('discover.notifications.title'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/discover/notifications');
});

test('adding settings keeps the circle management entry in the header', () => {
  render(<CirclePlazaScreen />);
  fireEvent.press(screen.getByLabelText('discover.management'));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/discover/management');
});

test('a long localized title can shrink instead of pushing the header actions off screen', () => {
  render(<CirclePlazaScreen />);
  const title = screen.getByRole('header');
  const flat = Object.assign({}, ...[title.props.style].flat(Infinity));
  expect(flat.flexShrink).toBe(1);
  expect(title.props.numberOfLines).toBe(1);
});
