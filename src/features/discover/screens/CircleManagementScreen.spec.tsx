import React from 'react';
import { render, screen } from '@testing-library/react-native';
import CircleManagementScreen from './CircleManagementScreen';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useNavigation: () => ({ canGoBack: () => true, goBack: jest.fn(), getState: () => ({ routes: [] }) }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/features/discover/components/my-circles-panel', () => ({ MyCirclesPanel: () => null }));

test('circle management no longer offers notification settings; that entry moved to the circle feed', () => {
  render(<CircleManagementScreen />);
  expect(screen.getByText('discover.management')).toBeTruthy();
  expect(screen.queryByLabelText('discover.notifications.title')).toBeNull();
});
