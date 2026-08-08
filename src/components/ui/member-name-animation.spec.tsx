import { act, render, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import {
  MemberNameAnimationProvider,
  useMemberNameAnimation,
} from './member-name-animation';

// 共享时钟的价值全在生命周期上:后台不烧 CPU、Reduce Motion 用户不看流光、
// 最后一个消费者走了要停。读源码的断言证明不了这些 —— 回调不再改状态、
// 引用计数写错、监听不清理,那种测试照样绿。这份用真实挂载/卸载来验。
jest.mock('react-native-reanimated', () => {
  // running = 时钟此刻在不在跑。只数调用次数是不够的:引用计数退化成布尔时,
  // effect 会重跑一次(cancel 后不再 withRepeat),而 repeats 计数并不变化 ——
  // 只断言 repeats 的话那个 bug 照样绿。
  const state = { repeats: 0, cancels: 0, running: false };
  return {
    __state: state,
    useSharedValue: (initial: number) => ({ value: initial }),
    withTiming: (toValue: number) => toValue,
    withRepeat: (value: number) => {
      state.repeats += 1;
      state.running = true;
      return value;
    },
    cancelAnimation: () => {
      state.cancels += 1;
      state.running = false;
    },
    Easing: { linear: (t: number) => t },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const reanimated = require('react-native-reanimated') as {
  __state: { repeats: number; cancels: number; running: boolean };
};

type AppStateListener = (next: AppStateStatus) => void;
type ReduceMotionListener = (enabled: boolean) => void;

let appStateListeners: AppStateListener[] = [];
let reduceMotionListeners: ReduceMotionListener[] = [];
let appStateRemovals = 0;
let reduceMotionRemovals = 0;
let reduceMotionInitial: Promise<boolean>;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemberNameAnimationProvider>{children}</MemberNameAnimationProvider>
  );
}

beforeEach(() => {
  reanimated.__state.repeats = 0;
  reanimated.__state.cancels = 0;
  reanimated.__state.running = false;
  appStateListeners = [];
  reduceMotionListeners = [];
  appStateRemovals = 0;
  reduceMotionRemovals = 0;
  reduceMotionInitial = Promise.resolve(false);

  // AppState.currentState 决定 provider 的初始 appIsActive。
  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      appStateListeners.push(listener as AppStateListener);
      return {
        remove: () => {
          appStateRemovals += 1;
        },
      } as ReturnType<typeof AppState.addEventListener>;
    });

  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => reduceMotionInitial);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((_event, listener) => {
      reduceMotionListeners.push(listener as unknown as ReduceMotionListener);
      return {
        remove: () => {
          reduceMotionRemovals += 1;
        },
      } as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function Consumer() {
  useMemberNameAnimation(true);
  return null;
}

/**
 * 单个 provider 内挂 n 个消费者。不能用多次 renderHook 来模拟「多个消费者」——
 * 每次 renderHook 都会连 wrapper 一起重挂,得到的是 n 个各带一个消费者的
 * 独立 provider,引用计数根本没被测到。
 */
function Harness({ count }: { count: number }) {
  return (
    <MemberNameAnimationProvider>
      {Array.from({ length: count }, (_, i) => (
        <Consumer key={i} />
      ))}
    </MemberNameAnimationProvider>
  );
}

async function flushEffects() {
  await act(async () => {
    await reduceMotionInitial;
  });
}

describe('MemberNameAnimationProvider', () => {
  test('starts the clock only once a consumer registers', async () => {
    const { result } = renderHook(() => useMemberNameAnimation(false), {
      wrapper,
    });
    await flushEffects();

    // enabled=false 的组件不注册消费者,时钟不该跑。
    expect(reanimated.__state.running).toBe(false);
    expect(reanimated.__state.repeats).toBe(0);
    expect(result.current.reduceMotionEnabled).toBe(false);
  });

  test('runs the clock while at least one consumer is mounted', async () => {
    render(<Harness count={1} />);
    await flushEffects();
    expect(reanimated.__state.running).toBe(true);
  });

  test('keeps running until the LAST consumer unmounts', async () => {
    const { rerender } = render(<Harness count={2} />);
    await flushEffects();
    expect(reanimated.__state.running).toBe(true);

    // 少一个消费者不该停:引用计数写成布尔的话这里就停了,
    // 列表里其它还在显示的会员名字会集体僵住。
    await act(async () => {
      rerender(<Harness count={1} />);
    });
    expect(reanimated.__state.running).toBe(true);

    // 最后一个走了才停 —— 不停的话没人看的动画会一直烧 CPU。
    await act(async () => {
      rerender(<Harness count={0} />);
    });
    expect(reanimated.__state.running).toBe(false);
  });

  test('pauses in the background and resumes on foreground', async () => {
    render(<Harness count={1} />);
    await flushEffects();
    expect(reanimated.__state.running).toBe(true);

    await act(async () => {
      appStateListeners.forEach((listener) => listener('background'));
    });
    // 后台不该继续跑:这正是这次改动要省的电。
    expect(reanimated.__state.running).toBe(false);

    await act(async () => {
      appStateListeners.forEach((listener) => listener('active'));
    });
    expect(reanimated.__state.running).toBe(true);
  });

  test('never runs while Reduce Motion is on, and stops when it turns on', async () => {
    reduceMotionInitial = Promise.resolve(true);
    render(<Harness count={1} />);
    await flushEffects();
    // 系统偏好读完之前默认禁用,读完仍是 true → 全程不跑。
    expect(reanimated.__state.running).toBe(false);
    expect(reanimated.__state.repeats).toBe(0);

    await act(async () => {
      reduceMotionListeners.forEach((listener) => listener(false));
    });
    expect(reanimated.__state.running).toBe(true);

    // 运行中被打开:必须当场停,而不是等下次重挂载。
    await act(async () => {
      reduceMotionListeners.forEach((listener) => listener(true));
    });
    expect(reanimated.__state.running).toBe(false);
  });

  test('removes both system listeners when the provider unmounts', async () => {
    const { unmount } = renderHook(() => useMemberNameAnimation(true), {
      wrapper,
    });
    await flushEffects();

    await act(async () => {
      unmount();
    });
    // 漏掉 remove 的话,provider 每次重建都会多留一份订阅,状态被旧实例反复改写。
    expect(appStateRemovals).toBeGreaterThan(0);
    expect(reduceMotionRemovals).toBeGreaterThan(0);
  });

  test('the clock restarts after every consumer has come and gone', async () => {
    const { rerender } = render(<Harness count={1} />);
    await flushEffects();
    await act(async () => {
      rerender(<Harness count={0} />);
    });
    expect(reanimated.__state.running).toBe(false);

    // 计数被打成负数的话,下一个消费者挂上来时时钟起不来(名字永远不流光)。
    await act(async () => {
      rerender(<Harness count={1} />);
    });
    expect(reanimated.__state.running).toBe(true);
  });
});
