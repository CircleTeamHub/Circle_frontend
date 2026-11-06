import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AppSettingsScreen from './AppSettingsScreen';

const mockPush = jest.fn();
const mockT = (key: string) => key;
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void) => { jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]); } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme/tokens'), useTheme: () => ({ colors: {} }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: jest.fn(), switchAccount: jest.fn(), submitting: false }) }));
jest.mock('@/services/cache/clear-app-cache', () => ({ getAppCacheSize: async () => 0, formatCacheSize: () => '0 B' }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); });

test.each([
  ['profileFields.email', '/(tabs)/profile/change-email'],
  ['settingsDetails.accountSecurity.cancelAccount', '/(tabs)/profile/cancel-account'],
  ['settingsDetails.privacy.onlineTime', '/(tabs)/profile/settings-privacy'],
  ['settingsDetails.privacy.singleTyping', '/(tabs)/profile/settings-privacy'],
  ['settingsDetails.privacy.groupTyping', '/(tabs)/profile/settings-privacy'],
  ['settingsDetails.privacy.allowFriendGroupDirectJoin', '/(tabs)/profile/settings-privacy'],
])('search finds %s with its dedicated route', async (label, route) => {
  render(<AppSettingsScreen />);
  await act(async () => {});
  fireEvent.changeText(screen.getByPlaceholderText('appSettings.searchPlaceholder'), label);
  fireEvent.press(screen.getByText(label));
  expect(mockPush).toHaveBeenCalledWith(route);
  await act(async () => {});
});
