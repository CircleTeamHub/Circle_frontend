import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useAssistantSpriteMotion } from './use-assistant-sprite-motion';

function mockReduceMotion(enabled: boolean) {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(enabled);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as never);
}

// React and the test renderer keep short timers of their own; the idle blink
// is the only one scheduled seconds out.
function blinkTimers(spy: jest.SpyInstance) {
  return spy.mock.results.filter(
    (_, i) => Number(spy.mock.calls[i][1]) >= 2000,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('schedules an idle blink and clears it on unmount', async () => {
  mockReduceMotion(false);
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
  const { unmount } = renderHook(() => useAssistantSpriteMotion(false));
  await act(async () => {});

  const scheduled = blinkTimers(setTimeoutSpy);
  expect(scheduled).toHaveLength(1);
  unmount();
  expect(clearTimeoutSpy).toHaveBeenCalledWith(scheduled[0].value);
});

test('never schedules a blink when the system asks to reduce motion', async () => {
  mockReduceMotion(true);
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  renderHook(() => useAssistantSpriteMotion(false));
  await act(async () => {});

  expect(blinkTimers(setTimeoutSpy)).toHaveLength(0);
});
