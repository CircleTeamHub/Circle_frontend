import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ProfileFieldEditSheet } from './profile-field-edit-sheet';
import { updateUserProfile } from '@/services/api/profile';

jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: () => 'failed' }));
jest.mock('@/services/api/profile', () => ({ updateUserProfile: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { id: 'u', gender: '男' }, setUser: jest.fn() }) }));
jest.mock('@/theme', () => ({ Radius: { lg: 12 }, Spacing: { md: 12, lg: 16 }, Typography: { body: {} }, useTheme: () => ({ colors: {} }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/hooks/use-modal-input-auto-focus', () => ({ useModalInputAutoFocus: jest.fn(), MODAL_INPUT_NATIVE_AUTO_FOCUS: false }));
jest.mock('@/components/ui/bottom-sheet-modal', () => ({ BottomSheetModal: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('@/features/profile/components/profile-picker-columns', () => ({ BirthdayColumns: () => null, CityColumns: () => null }));

test('two gender taps in one render submit only one update', () => {
  jest.mocked(updateUserProfile).mockReturnValue(new Promise(() => {}));
  const ui = render(<ProfileFieldEditSheet fieldId="gender" onClose={jest.fn()} />);
  act(() => {
    fireEvent.press(ui.getByText('profileFields.male'));
    fireEvent.press(ui.getByText('profileFields.female'));
  });
  expect(updateUserProfile).toHaveBeenCalledTimes(1);
});
