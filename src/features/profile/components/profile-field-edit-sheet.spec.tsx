import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ProfileFieldEditSheet } from './profile-field-edit-sheet';
import { updateUserProfile } from '@/services/api/profile';

const mockSetUser = jest.fn();
let mockSessionEpoch = 1;

jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: () => 'failed' }));
jest.mock('@/services/api/profile', () => ({ updateUserProfile: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (s: unknown) => unknown) => select({ user: { id: 'u', gender: '男' }, setUser: mockSetUser }), { getState: () => ({ sessionEpoch: mockSessionEpoch }) }) }));
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

test.each([false, true])('a save cannot update the next session (editor unmounted: %s)', async (unmount) => {
  mockSetUser.mockClear();
  let resolve!: (user: never) => void;
  jest.mocked(updateUserProfile).mockReturnValue(new Promise((done) => { resolve = done; }));
  const onClose = jest.fn();
  const ui = render(<ProfileFieldEditSheet fieldId="gender" onClose={onClose} />);
  fireEvent.press(ui.getByText('profileFields.male'));
  if (unmount) ui.unmount();
  mockSessionEpoch += 1;
  await act(async () => { resolve({ id: 'u', gender: '男' } as never); });
  expect(mockSetUser).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
