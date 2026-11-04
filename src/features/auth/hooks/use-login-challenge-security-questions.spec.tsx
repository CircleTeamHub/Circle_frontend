import { act, renderHook, waitFor } from '@testing-library/react-native';
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
  expect(result.current.questionKeys).toEqual([]);

  rerender({ challengeId: 'c2' });

  await waitFor(() => expect(result.current.questionKeys).toEqual(['bestFriendName', 'primarySchool']));
  expect(fetchLoginChallengeSecurityQuestions).toHaveBeenLastCalledWith('c2');
});

test('a transient lookup failure can be retried without replacing the challenge', async () => {
  jest.mocked(fetchLoginChallengeSecurityQuestions)
    .mockRejectedValueOnce(new Error('network unavailable'))
    .mockResolvedValueOnce(['bestFriendName', 'primarySchool']);
  const { result } = renderHook(() => useLoginChallengeSecurityQuestions('c1'));

  await waitFor(() => expect(result.current.failed).toBe(true));
  act(() => result.current.retry());

  await waitFor(() => expect(result.current.questionKeys).toEqual(['bestFriendName', 'primarySchool']));
  expect(result.current.failed).toBe(false);
  expect(fetchLoginChallengeSecurityQuestions).toHaveBeenCalledTimes(2);
  expect(fetchLoginChallengeSecurityQuestions).toHaveBeenLastCalledWith('c1');
});

test('a failed request for the old challenge cannot replace a successful new lookup', async () => {
  let rejectOld!: (reason: Error) => void;
  jest.mocked(fetchLoginChallengeSecurityQuestions)
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
    .mockResolvedValueOnce(['bestFriendName', 'primarySchool']);
  const { result, rerender } = renderHook(({ id }: { id: string }) => useLoginChallengeSecurityQuestions(id), { initialProps: { id: 'c1' } });
  rerender({ id: 'c2' });
  await waitFor(() => expect(result.current.questionKeys).toEqual(['bestFriendName', 'primarySchool']));
  await act(async () => rejectOld(new Error('old request failed')));
  expect(result.current.failed).toBe(false);
});
