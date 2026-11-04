import { renderHook, waitFor } from '@testing-library/react-native';
import { useLoginChallengeSecurityQuestions } from './use-login-challenge-security-questions';
import { fetchLoginChallengeSecurityQuestions } from '@/services/api/auth';

jest.mock('@/services/api/auth', () => ({
  fetchLoginChallengeSecurityQuestions: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

test('a failed lookup is retried on the replacement challenge after a resend', async () => {
  jest
    .mocked(fetchLoginChallengeSecurityQuestions)
    .mockRejectedValueOnce(new Error('challenge expired'))
    .mockResolvedValueOnce(['bestFriendName', 'primarySchool']);
  const { result, rerender } = renderHook(
    ({ challengeId }: { challengeId: string }) =>
      useLoginChallengeSecurityQuestions(challengeId),
    { initialProps: { challengeId: 'c1' } },
  );
  await waitFor(() => expect(fetchLoginChallengeSecurityQuestions).toHaveBeenCalledWith('c1'));
  expect(result.current).toEqual([]);

  rerender({ challengeId: 'c2' });

  await waitFor(() => expect(result.current).toEqual(['bestFriendName', 'primarySchool']));
  expect(fetchLoginChallengeSecurityQuestions).toHaveBeenLastCalledWith('c2');
});
