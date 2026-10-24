import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { create } from 'zustand';
import { useStoreWhileActive } from './use-store-while-active';

// 会话列表压在聊天页下面时,原生栈不会冻结它(要给右滑返回露出来)。这个 hook
// 是列表自己停下来的办法:不活跃就不订阅,store 怎么变都不重渲染。
interface CounterState {
  count: number;
  bump: () => void;
}

const useCounterStore = create<CounterState>((set) => ({
  count: 0,
  bump: () => set((state) => ({ count: state.count + 1 })),
}));

const selectCount = (state: CounterState) => state.count;

let renders = 0;

function Probe({ active }: { active: boolean }) {
  renders += 1;
  const count = useStoreWhileActive(useCounterStore, selectCount, active);
  return <Text testID="count">{String(count)}</Text>;
}

function shownCount(): string {
  return String(screen.getByTestId('count').props.children);
}

beforeEach(() => {
  renders = 0;
  useCounterStore.setState({ count: 0 });
});

describe('useStoreWhileActive', () => {
  test('follows the store while active', () => {
    render(<Probe active />);
    act(() => useCounterStore.getState().bump());
    expect(shownCount()).toBe('1');
  });

  test('ignores store changes while inactive, without re-rendering', () => {
    render(<Probe active={false} />);
    const before = renders;

    act(() => {
      useCounterStore.getState().bump();
      useCounterStore.getState().bump();
    });

    expect(renders).toBe(before);
    expect(shownCount()).toBe('0');
  });

  test('catches up with the latest state as soon as it becomes active again', () => {
    const { rerender } = render(<Probe active />);
    rerender(<Probe active={false} />);
    act(() => {
      useCounterStore.getState().bump();
      useCounterStore.getState().bump();
      useCounterStore.getState().bump();
    });
    expect(shownCount()).toBe('0');

    rerender(<Probe active />);
    expect(shownCount()).toBe('3');

    act(() => useCounterStore.getState().bump());
    expect(shownCount()).toBe('4');
  });
});
