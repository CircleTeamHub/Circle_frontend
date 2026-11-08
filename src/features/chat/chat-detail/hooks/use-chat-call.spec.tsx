import React, { type ReactNode } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { createDirectCall } from '@/services/api/calls';
import { ChatSheetNavigationContext } from './use-chat-router';
import { useChatCall } from './use-chat-call';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn() },
  useSegments: () => ['quick-chat'],
}));
jest.mock('@/services/api/calls', () => ({
  createDirectCall: jest.fn(),
  createGroupCall: jest.fn(),
}));
jest.mock('@/chat-core/api', () => ({ fetchChatMembers: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/call/store/use-call-store', () => ({
  useCallStore: (select: (state: { setActiveCall: () => void }) => unknown) =>
    select({ setActiveCall: jest.fn() }),
}));

const PEER = '11111111-1111-4111-8111-111111111111';
const t = ((key: string) => key) as never;

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(createDirectCall).mockResolvedValue({ call: { id: 'call-1' }, livekit: {} } as never);
});

afterEach(() => {
  alertSpy.mockRestore();
});

function renderCall(mounted: boolean, dismiss: jest.Mock) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ChatSheetNavigationContext.Provider value={{ dismiss }}>{children}</ChatSheetNavigationContext.Provider>
  );
  return renderHook(
    () =>
      useChatCall({
        t,
        authUser: { id: 'me' } as never,
        mountedRef: { current: mounted },
        sourceID: PEER,
        conversationID: `direct:me:${PEER}`,
        isGroupChat: false,
        revalidateMemberViewAccess: async () => true,
        isPreviewMode: false,
      }),
    { wrapper },
  );
}

async function chooseVoiceCall(result: { current: ReturnType<typeof useChatCall> }) {
  act(() => {
    result.current.handleStartCall();
  });
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as AlertButton[];
  await act(async () => {
    buttons.find((button) => button.text === 'call.typeVoice')?.onPress?.();
  });
}

// 回归:半屏聊天里发起通话,通话页直接 push 到根栈,iOS 把它放在半屏下面,对方在响铃、自己看不见;
// 再点半屏空白处关闭,退掉的是那个看不见的通话页。进通话页是「离开聊天」,要先关半屏。
test('a call started from the half-screen chat closes the sheet before opening the call screen', async () => {
  const order: string[] = [];
  const dismiss = jest.fn(() => order.push('dismiss'));
  jest.mocked(router.push).mockImplementation(() => {
    order.push('push');
  });
  const { result } = renderCall(true, dismiss);

  await chooseVoiceCall(result);

  expect(router.push).toHaveBeenCalledWith('/(chat)/group-call');
  expect(order).toEqual(['dismiss', 'push']);
});

// 用户在建单途中自己关了半屏(聊天页已卸载):不能再关一次,否则退掉的是下面的页面。
test('a call that resolves after the sheet was closed does not close anything else', async () => {
  const dismiss = jest.fn();
  const { result } = renderCall(false, dismiss);

  await chooseVoiceCall(result);

  expect(router.push).toHaveBeenCalledWith('/(chat)/group-call');
  expect(dismiss).not.toHaveBeenCalled();
});
