import { fetchPendingLoginChallenges } from '@/services/api/auth';
import { setLoginChallengeListener } from '@/realtime/client';
import { useLoginApprovalStore } from './login-approval-store';

jest.mock('@/services/api/auth', () => ({ fetchPendingLoginChallenges: jest.fn() }));
jest.mock('@/realtime/client', () => ({ setLoginChallengeListener: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

beforeEach(() => {
  useLoginApprovalStore.getState().reset();
  jest.mocked(fetchPendingLoginChallenges).mockReset();
});

test('a realtime challenge arriving during a stale fetch triggers a trailing refresh', async () => {
  let complete!: (value: never[]) => void;
  jest.mocked(fetchPendingLoginChallenges).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  jest.mocked(fetchPendingLoginChallenges).mockResolvedValueOnce([{ id: 'new-challenge' }] as never);
  const listener = jest.mocked(setLoginChallengeListener).mock.calls[0][0]!;
  const pending = useLoginApprovalStore.getState().refresh();
  listener({ type: 'created' });
  listener({ type: 'created' });
  expect(fetchPendingLoginChallenges).toHaveBeenCalledTimes(1);
  complete([]);
  await pending;
  expect(fetchPendingLoginChallenges).toHaveBeenCalledTimes(2);
  expect(useLoginApprovalStore.getState().pending.map(item => item.id)).toEqual(['new-challenge']);
});

test('queued refreshes from the old account do not replay or overwrite the new account', async () => {
  let complete!: (value: never[]) => void;
  jest.mocked(fetchPendingLoginChallenges).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = useLoginApprovalStore.getState().refresh();
  void useLoginApprovalStore.getState().refresh();
  useLoginApprovalStore.getState().reset();
  jest.mocked(fetchPendingLoginChallenges).mockResolvedValueOnce([{ id: 'account-b' }] as never);
  await useLoginApprovalStore.getState().refresh();
  complete([]);
  await pending;
  expect(fetchPendingLoginChallenges).toHaveBeenCalledTimes(2);
  expect(useLoginApprovalStore.getState().pending.map(item => item.id)).toEqual(['account-b']);
});
