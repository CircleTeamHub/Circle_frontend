import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import DeviceVerificationScreen from './DeviceVerificationScreen';
import { useDeviceVerificationStore } from '../store/device-verification-store';

const mockReplace = jest.fn();
let mockSubmitting = false;
let mockCommitting = false;
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, canGoBack: () => true, back: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: () => 'failed' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => {
 const tokens = jest.requireActual('@/theme/tokens');
 const palettes = jest.requireActual('@/theme/colors');
 return { ...tokens, useTheme: () => ({ colors: palettes.darkColors }) };
});
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ completeVerifiedLogin: jest.fn(), committing: mockCommitting }) }));
jest.mock('@/features/auth/hooks/use-device-verification', () => ({ useDeviceVerification: () => ({ phase: 'waiting', remainingSeconds: 300, recoveryAvailableAt: null, submitting: mockSubmitting, error: null }) }));

beforeEach(() => { jest.clearAllMocks(); mockSubmitting = false; mockCommitting = false; useDeviceVerificationStore.getState().setChallenge({ id: 'challenge', expiresAt: new Date(Date.now()+300000).toISOString(), securityCodeAvailable: false, recoveryAvailableAt: null }); });
afterEach(() => { useDeviceVerificationStore.getState().setChallenge(null); });
test('offers email recovery without requiring a trusted device or security code', () => {
 render(<DeviceVerificationScreen />);
 expect(screen.getByText('auth.deviceVerification.recoveryIntro')).toBeTruthy();
 fireEvent.press(screen.getByRole('link'));
 expect(mockReplace).toHaveBeenCalledWith('/(auth)/forgot-password');
});
test.each(['verification', 'commit'])('does not leave while %s is in flight', (phase) => {
 mockSubmitting = phase === 'verification'; mockCommitting = phase === 'commit';
 render(<DeviceVerificationScreen />); fireEvent.press(screen.getByRole('link'));
 expect(mockReplace).not.toHaveBeenCalled();
});
