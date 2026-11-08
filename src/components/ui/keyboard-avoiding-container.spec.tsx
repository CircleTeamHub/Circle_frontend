import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Keyboard, KeyboardAvoidingView, LayoutAnimation, Platform, StyleSheet, View, type KeyboardEvent } from 'react-native';
import { KeyboardAvoidingContainer } from './keyboard-avoiding-container';

afterEach(() => jest.restoreAllMocks());

function setup(platform: 'android' | 'ios', initiallyVisible = false) {
  jest.replaceProperty(Platform, 'OS', platform);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(initiallyVisible);
  const listeners = new Map<string, ((event: KeyboardEvent) => void)[]>();
  const remove = jest.fn();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
    listeners.set(event, [...(listeners.get(event) ?? []), callback]);
    return { remove } as unknown as ReturnType<typeof Keyboard.addListener>;
  });
  return {
    remove,
    emit: async (name: string) => {
      await act(async () => {
        // The hidden Android window still excludes the 31dp status bar and 48dp taskbar.
        const event: KeyboardEvent = { duration: 0, easing: 'keyboard', endCoordinates: {
          screenX: 0, screenY: name === 'keyboardDidHide' ? 750 : 480,
          width: 690, height: name === 'keyboardDidHide' ? 0 : 349,
        } };
        for (const callback of listeners.get(name) ?? []) callback(event);
      });
    },
  };
}

test('Android drops keyboard avoidance after hide even when the hide coordinates exclude system bars', async () => {
  const {emit} = setup('android');
  const screen = render(<KeyboardAvoidingContainer><View /></KeyboardAvoidingContainer>);
  const container = () => screen.UNSAFE_getByType(KeyboardAvoidingView);
  expect(container().props.enabled).toBe(false);
  await emit('keyboardDidShow');
  expect(container().props.enabled).toBe(true);
  await emit('keyboardDidHide');
  expect(container().props.enabled).toBe(false);
  await emit('keyboardDidShow');
  expect(container().props.enabled).toBe(true);
});

test('Android respects the caller disabling avoidance and removes its listeners', async () => {
  const {emit, remove} = setup('android');
  const screen = render(<KeyboardAvoidingContainer enabled={false}><View /></KeyboardAvoidingContainer>);
  await emit('keyboardDidShow');
  // 调用方关掉避让 = 不加任何键盘留白(behavior 为空时 RN 渲染成普通 View)。
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBeUndefined();
  screen.unmount();
  expect(remove).toHaveBeenCalled();
});

test('mounting with an already open Android keyboard enables avoidance immediately', () => {
  setup('android', true);
  const screen = render(<KeyboardAvoidingContainer><View /></KeyboardAvoidingContainer>);
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.enabled).toBe(true);
});

test('iOS keeps its existing keyboard animation behavior', () => {
  setup('ios');
  const screen = render(<KeyboardAvoidingContainer><View /></KeyboardAvoidingContainer>);
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.enabled).toBe(true);
});

test('Android animates layout on show and hide even when native events have zero duration', async () => {
  const { emit } = setup('android');
  const animate = jest.spyOn(LayoutAnimation, 'configureNext');
  render(<KeyboardAvoidingContainer><View /></KeyboardAvoidingContainer>);
  await emit('keyboardDidShow');
  expect(animate).toHaveBeenCalledWith(expect.objectContaining({ duration: expect.any(Number) }));
  animate.mockClear();
  await emit('keyboardDidHide');
  expect(animate).toHaveBeenCalledWith(expect.objectContaining({ duration: expect.any(Number) }));
});

// 聊天页的表情 / 「+」面板展开时会关掉避让,键盘就在这期间收起。RN 的 KeyboardAvoidingView
// 关着时不更新自己的 state,重新打开的那一帧照旧按上次的键盘高度留白,紧接着才归零 ——
// 从面板点回输入框,输入栏会先跳到旧高度、再掉到底、再跟着键盘升上来。
test('re-enabling after the keyboard closed while disabled never paints the old keyboard inset', async () => {
  const { emit } = setup('ios');
  const insets: number[] = [];
  const compose = jest.spyOn(StyleSheet, 'compose').mockImplementation((style, extra) => {
    const padding = (extra as { paddingBottom?: number } | null)?.paddingBottom;
    if (typeof padding === 'number') insets.push(padding);
    return [style, extra] as never;
  });
  const screen = render(<KeyboardAvoidingContainer><View /></KeyboardAvoidingContainer>);
  const host = screen.UNSAFE_getByType(KeyboardAvoidingView).findByType(View);
  await act(async () => {
    host.props.onLayout({ persist: () => undefined, nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
  });
  await emit('keyboardWillShow');
  expect(insets.at(-1)).toBe(364);

  screen.rerender(<KeyboardAvoidingContainer enabled={false}><View /></KeyboardAvoidingContainer>);
  await emit('keyboardWillHide');
  insets.length = 0;
  screen.rerender(<KeyboardAvoidingContainer><View /></KeyboardAvoidingContainer>);
  expect(insets).not.toContain(364);
  expect(insets.at(-1)).toBe(0);
  compose.mockRestore();
});
