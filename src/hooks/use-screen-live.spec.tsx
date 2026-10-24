import { act, render, screen } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import type { ContextType } from 'react';
import { Text } from 'react-native';
import { useScreenLive } from './use-screen-live';

// 右滑返回时,isFocused 要等手势结束才变 true;只看它的话,露出来的是聊天页压上去那一刻
// 的旧会话列表,松手才跳成最新。栈在手势一开始就给底下这页发 transitionStart。
type EventName = 'focus' | 'blur' | 'transitionStart' | 'transitionEnd';
type Listener = (event: { data?: { closing?: boolean } }) => void;

function createStackScreen(initiallyFocused: boolean) {
  let focused = initiallyFocused;
  const listeners = new Map<EventName, Set<Listener>>();
  const emit = (type: EventName, data?: { closing?: boolean }) =>
    listeners.get(type)?.forEach((listener) => listener({ data }));
  const navigation = {
    isFocused: () => focused,
    addListener: (type: EventName, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
      return () => set.delete(listener);
    },
  };
  return {
    navigation: navigation as unknown as NonNullable<ContextType<typeof NavigationContext>>,
    revealStart: () => emit('transitionStart', { closing: false }),
    revealCancelled: () => emit('transitionEnd', { closing: true }),
    focus: () => {
      focused = true;
      emit('focus');
    },
    blur: () => {
      focused = false;
      emit('blur');
    },
  };
}

function Probe() {
  return <Text testID="live">{String(useScreenLive())}</Text>;
}

function live(): string {
  return String(screen.getByTestId('live').props.children);
}

function renderOn(stackScreen: ReturnType<typeof createStackScreen>) {
  render(
    <NavigationContext.Provider value={stackScreen.navigation}>
      <Probe />
    </NavigationContext.Provider>,
  );
}

describe('useScreenLive', () => {
  test('is live while focused and idle once covered', () => {
    const stackScreen = createStackScreen(true);
    renderOn(stackScreen);
    expect(live()).toBe('true');

    act(() => stackScreen.blur());
    expect(live()).toBe('false');
  });

  test('comes alive as soon as a back gesture starts revealing it', () => {
    const stackScreen = createStackScreen(false);
    renderOn(stackScreen);
    expect(live()).toBe('false');

    // 手势刚开始,还没 focus:列表已经要是最新的。
    act(() => stackScreen.revealStart());
    expect(live()).toBe('true');

    act(() => stackScreen.focus());
    expect(live()).toBe('true');
  });

  test('goes idle again when the back gesture is cancelled', () => {
    const stackScreen = createStackScreen(false);
    renderOn(stackScreen);
    act(() => stackScreen.revealStart());
    expect(live()).toBe('true');

    act(() => stackScreen.revealCancelled());
    expect(live()).toBe('false');
  });

  test('a later push does not inherit a stale reveal', () => {
    const stackScreen = createStackScreen(false);
    renderOn(stackScreen);
    act(() => {
      stackScreen.revealStart();
      stackScreen.focus();
    });
    act(() => stackScreen.blur());
    expect(live()).toBe('false');
  });
});
