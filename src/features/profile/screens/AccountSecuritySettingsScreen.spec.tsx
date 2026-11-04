import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AccountSecuritySettingsScreen from './AccountSecuritySettingsScreen';
import { fetchSecurityQuestions } from '@/services/api/auth';

type Row = { id: string; valueKey?: string };
let mockSections: { rows: Row[] }[] = [];
let mockRefocus: (() => void) | null = null;

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (effect: () => void) => {
      mockRefocus = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('@/features/profile/components/settings-detail', () => ({
  SettingsDetailScreen: (props: { sections: { rows: Row[] }[] }) => {
    mockSections = props.sections;
    return null;
  },
}));
jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ logout: jest.fn(), switchAccount: jest.fn(), submitting: false }),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/auth', () => ({
  fetchLoginSecurityCodeStatus: jest.fn(async () => ({ enabled: false })),
  fetchSecurityQuestions: jest.fn(),
  fetchSingleDeviceLoginStatus: jest.fn(async () => ({ enabled: false })),
  setSingleDeviceLogin: jest.fn(),
}));

const securityQuestionsRow = () =>
  mockSections.flatMap((section) => section.rows).find((row) => row.id === 'security-questions');

test('an older status response arriving last does not overwrite the newer one', async () => {
  const pending: ((keys: string[]) => void)[] = [];
  jest.mocked(fetchSecurityQuestions).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve as (keys: string[]) => void)) as never,
  );
  render(<AccountSecuritySettingsScreen />);
  await waitFor(() => expect(pending).toHaveLength(1));

  // 从密保设置页返回：再次聚焦，第二个请求发出，而第一个还没回来。
  act(() => mockRefocus!());
  expect(pending).toHaveLength(2);

  await act(async () => pending[1](['birthCity', 'firstPetName']));
  await act(async () => pending[0]([]));

  expect(securityQuestionsRow()?.valueKey).toBe(
    'settingsDetails.accountSecurity.securityQuestionsSet',
  );
});
