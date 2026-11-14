import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import SelectCityScreen from './SelectCityScreen';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import { useCityPickStore } from '@/features/discover/store/use-city-pick-store';

const mockBack = jest.fn();
let mockParams: Record<string, string> = { multiSelect: 'true', target: 'post' };

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
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

beforeEach(() => {
  mockBack.mockClear();
  mockParams = { multiSelect: 'true', target: 'post' };
});

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

test('the note title picks exactly one city, starts from the current one and hides 全国', () => {
  mockParams = { target: 'note', city: '上海' };
  render(<SelectCityScreen />);

  expect(screen.queryByText('city.nationwide')).toBeNull();
  expect(screen.getByRole('button', { name: '上海' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByRole('button', { name: '深圳' }));
  expect(screen.getByRole('button', { name: '上海' }).props.accessibilityState.selected).toBe(false);
  fireEvent.press(screen.getByText('city.confirmSelection'));

  expect(useCityPickStore.getState().consume('note')).toBe('深圳');
  // 只交给发起的那个入口，取过一次就没了。
  expect(useCityPickStore.getState().consume('note')).toBeNull();
  expect(useCityPickStore.getState().consume('ranking')).toBeNull();
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('confirming the ranking filter without choosing anything changes nothing', () => {
  mockParams = { target: 'ranking' };
  render(<SelectCityScreen />);
  fireEvent.press(screen.getByText('city.confirmSelection'));
  expect(useCityPickStore.getState().consume('ranking')).toBeNull();
  expect(mockBack).toHaveBeenCalledTimes(1);
});
