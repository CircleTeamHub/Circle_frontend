import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TopNoticeHost } from './top-notice-host';
import { showTopNotice, topNotice, useTopNoticeStore } from './top-notice-store';

// 玻璃材质的两个原生模块 jest 里没有：退化成普通 View，只验证结构与行为。
jest.mock('expo-blur', () => {
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BlurView: () => null, BlurTargetView: RNView };
});
jest.mock('expo-glass-effect', () => {
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    GlassView: RNView,
    isGlassEffectAPIAvailable: () => false,
    isLiquidGlassAvailable: () => false,
  };
});

jest.mock('@/storage', () => ({
  storage: { getString: jest.fn(), set: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/hooks/use-reduce-motion', () => ({
  useReduceMotion: () => true,
}));

jest.mock('./top-notice-haptics', () => ({
  fireTopNoticeHaptic: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  jest.useFakeTimers();
  useTopNoticeStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('TopNoticeHost', () => {
  it('shows the notice and auto-hides it after its duration', () => {
    render(<TopNoticeHost />);

    act(() => {
      showTopNotice({ type: 'success', title: '已复制', message: '链接已复制', durationMs: 1000 });
    });
    expect(screen.getByText('已复制')).toBeTruthy();
    expect(screen.getByText('链接已复制')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(screen.getByText('已复制')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText('已复制')).toBeNull();
  });

  it('a newer notice replaces the current one and restarts the timer', () => {
    render(<TopNoticeHost />);

    act(() => {
      showTopNotice({ title: '第一条', durationMs: 1000 });
    });
    act(() => {
      jest.advanceTimersByTime(800);
    });
    act(() => {
      topNotice.error('第二条');
    });

    expect(screen.queryByText('第一条')).toBeNull();
    expect(screen.getByText('第二条')).toBeTruthy();

    // 第一条的计时器到点不能把第二条一起收掉。
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByText('第二条')).toBeTruthy();
  });

  it('runs the action and hides the notice when the action is pressed', () => {
    const onPress = jest.fn();
    render(<TopNoticeHost />);

    act(() => {
      showTopNotice({ title: '已添加到笔记', action: { label: '查看', onPress } });
    });
    fireEvent.press(screen.getByText('查看'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已添加到笔记')).toBeNull();
  });

  it('announces itself as an alert for screen readers', () => {
    render(<TopNoticeHost />);
    act(() => {
      topNotice.warning('注意');
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
