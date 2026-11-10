import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import SelectCityScreen from './SelectCityScreen';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ multiSelect: 'true', target: 'post' }),
  useFocusEffect: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: () => null }));
jest.mock('@/stores/membershipProgramStore', () => ({ useMembershipProgramStore: () => null }));
jest.mock('@/features/discover/store/use-discover-filter-store', () => ({
  useDiscoverFilterStore: () => undefined,
}));

test('selects a popular city and keeps the selection while searching the full list', () => {
  usePostFormStore.setState({ selectedCities: [] });
  render(<SelectCityScreen />);

  expect(screen.getByText('city.popularCities')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: '深圳' }));
  fireEvent.changeText(screen.getByPlaceholderText('city.searchPlaceholder'), '杭州');
  expect(screen.queryByText('city.popularCities')).toBeNull();
  fireEvent.press(screen.getByText('杭州'));
  fireEvent.press(screen.getByText('city.confirmSelection'));

  expect(usePostFormStore.getState().selectedCities).toEqual(['深圳', '杭州']);
  expect(mockBack).toHaveBeenCalledTimes(1);
});
