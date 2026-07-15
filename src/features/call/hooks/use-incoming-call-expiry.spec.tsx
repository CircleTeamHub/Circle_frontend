import { act, renderHook } from '@testing-library/react-native';
import { useIncomingCallExpiry } from './use-incoming-call-expiry';
import type { CallInvitePayload } from '../types';

// The hook only reads truthiness and `.expiresAt`, so a loose payload is enough.
const inviteExpiring = (expiresAt: string): CallInvitePayload =>
  ({ expiresAt }) as unknown as CallInvitePayload;

describe('useIncomingCallExpiry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('clears the incoming call once expiresAt passes', () => {
    const onExpire = jest.fn();
    const expiresAt = new Date(Date.now() + 45_000).toISOString();
    renderHook(() => useIncomingCallExpiry(inviteExpiring(expiresAt), onExpire));

    expect(onExpire).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(45_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('clears immediately when expiresAt is already in the past', () => {
    const onExpire = jest.fn();
    const expiresAt = new Date(Date.now() - 1_000).toISOString();
    renderHook(() => useIncomingCallExpiry(inviteExpiring(expiresAt), onExpire));

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('does nothing when there is no incoming call', () => {
    const onExpire = jest.fn();
    renderHook(() => useIncomingCallExpiry(null, onExpire));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  test('does not auto-clear when expiresAt is invalid', () => {
    const onExpire = jest.fn();
    renderHook(() => useIncomingCallExpiry(inviteExpiring('not-a-date'), onExpire));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  test('cancels the timer when the call clears before expiry', () => {
    const onExpire = jest.fn();
    const expiresAt = new Date(Date.now() + 45_000).toISOString();
    const { rerender } = renderHook(
      ({ call }: { call: CallInvitePayload | null }) =>
        useIncomingCallExpiry(call, onExpire),
      { initialProps: { call: inviteExpiring(expiresAt) as CallInvitePayload | null } },
    );

    rerender({ call: null });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });
});
