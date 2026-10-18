import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Keyboard, KeyboardAvoidingView, Platform, View, type KeyboardEvent } from 'react-native';
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
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.enabled).toBe(false);
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
