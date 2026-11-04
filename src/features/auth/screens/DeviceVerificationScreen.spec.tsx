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
const mockSubmitSecurityAnswers = jest.fn();
let mockQuestionKeys: string[] = [];
const mockQuestionsFor = jest.fn();
jest.mock('@/features/auth/hooks/use-device-verification', () => ({ useDeviceVerification: () => ({ challengeId: 'resent-challenge', phase: 'waiting', remainingSeconds: 300, recoveryAvailableAt: null, submitting: mockSubmitting, error: null, submitSecurityAnswers: mockSubmitSecurityAnswers }) }));
jest.mock('@/features/auth/hooks/use-login-challenge-security-questions', () => ({ useLoginChallengeSecurityQuestions: (challengeId: string) => { mockQuestionsFor(challengeId); return mockQuestionKeys; } }));

beforeEach(() => { jest.clearAllMocks(); mockSubmitting = false; mockCommitting = false; mockQuestionKeys = []; useDeviceVerificationStore.getState().setChallenge({ id: 'challenge', expiresAt: new Date(Date.now()+300000).toISOString(), securityCodeAvailable: false, recoveryAvailableAt: null }); });
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
test('hides the security-question option for accounts that never set one', () => {
 render(<DeviceVerificationScreen />);
 expect(screen.queryByText('auth.deviceVerification.useSecurityQuestions')).toBeNull();
});
test('answers the security questions instead of waiting for a trusted device', () => {
 mockQuestionKeys = ['bestFriendName', 'primarySchool'];
 render(<DeviceVerificationScreen />);
 fireEvent.press(screen.getByText('auth.deviceVerification.useSecurityQuestions'));
 expect(screen.getByText('auth.deviceVerification.securityQuestionsIntro')).toBeTruthy();
 expect(screen.getByText('securityQuestions.questions.bestFriendName')).toBeTruthy();
 fireEvent.press(screen.getByText('auth.deviceVerification.submit'));
 expect(mockSubmitSecurityAnswers).not.toHaveBeenCalled();
 fireEvent.changeText(screen.getByTestId('security-answer-0'), '张三');
 fireEvent.changeText(screen.getByTestId('security-answer-1'), '阳光小学');
 fireEvent.press(screen.getByText('auth.deviceVerification.submit'));
 expect(mockSubmitSecurityAnswers).toHaveBeenCalledWith(['张三', '阳光小学']);
 fireEvent.press(screen.getByText('auth.deviceVerification.useTrustedDevice'));
 expect(screen.queryByTestId('security-answer-0')).toBeNull();
});
test('looks up the security questions on the current challenge, not the one the screen opened with', () => {
 render(<DeviceVerificationScreen />);
 expect(mockQuestionsFor).toHaveBeenLastCalledWith('resent-challenge');
});
