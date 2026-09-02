import React from 'react';
import { Animated } from 'react-native';
import { configure, render, screen } from '@testing-library/react-native';
import { LoginSky } from './LoginSky';
import {
  DAY_DOTS,
  DAY_SPARKLES,
  NIGHT_STARS,
} from './login-sky-geometry';

// hero 整体对无障碍隐藏（纯装饰），查询时要把隐藏元素也算进来。
configure({ defaultIncludeHiddenElements: true });

let mockMode: 'light' | 'dark' = 'dark';

jest.mock('react-native-svg', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const stub = (name: string) => {
    const Stub = ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => ReactActual.createElement(View, { testID: testID ?? name }, children);
    Stub.displayName = name;
    return Stub;
  };
  return {
    __esModule: true,
    default: stub('Svg'),
    Svg: stub('Svg'),
    Circle: stub('Circle'),
    Defs: stub('Defs'),
    G: stub('G'),
    LinearGradient: stub('LinearGradient'),
    Path: stub('Path'),
    RadialGradient: stub('RadialGradient'),
    Stop: stub('Stop'),
  };
});

jest.mock('@/theme', () => {
  const tokens = jest.requireActual<typeof import('@/theme/tokens')>('@/theme/tokens');
  const palettes = jest.requireActual<typeof import('@/theme/colors')>('@/theme/colors');
  return {
    ...tokens,
    ...palettes,
    useTheme: () => ({
      colors: mockMode === 'dark' ? palettes.darkColors : palettes.lightColors,
      resolvedMode: mockMode,
      themeMode: mockMode,
      setThemeMode: jest.fn(),
      toggleTheme: jest.fn(),
    }),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('night sky renders white stars, the glowing trail and a halo behind the plane', () => {
  mockMode = 'dark';
  render(<LoginSky width={390} reduceMotion />);

  expect(screen.getByTestId('login-sky-plane')).toBeTruthy();
  expect(screen.getByTestId('login-sky-plane-halo')).toBeTruthy();
  expect(screen.getAllByTestId('login-sky-star')).toHaveLength(NIGHT_STARS.length);
  expect(screen.getAllByTestId('login-sky-trail-bloom')).toHaveLength(3);
  expect(screen.getByTestId('login-sky-trail')).toBeTruthy();
  expect(screen.queryAllByTestId('login-sky-sparkle')).toHaveLength(0);
  expect(screen.queryAllByTestId('login-sky-dot')).toHaveLength(0);
});

test('day sky swaps stars for purple dots and sparkles and drops the halo', () => {
  mockMode = 'light';
  render(<LoginSky width={390} reduceMotion />);

  expect(screen.getByTestId('login-sky-plane')).toBeTruthy();
  expect(screen.queryByTestId('login-sky-plane-halo')).toBeNull();
  expect(screen.queryAllByTestId('login-sky-star')).toHaveLength(0);
  expect(screen.getAllByTestId('login-sky-dot')).toHaveLength(DAY_DOTS.length);
  expect(screen.getAllByTestId('login-sky-sparkle')).toHaveLength(DAY_SPARKLES.length);
  expect(screen.getByTestId('login-sky-trail-underlay')).toBeTruthy();
  expect(screen.getByTestId('login-sky-trail')).toBeTruthy();
});

test('the hero is decorative: hidden from the accessibility tree', () => {
  mockMode = 'dark';
  render(<LoginSky width={390} reduceMotion />);

  expect(screen.queryByTestId('login-sky-plane', { includeHiddenElements: false })).toBeNull();
});

test('the reveal waits for the reduce-motion preference and plays exactly once', () => {
  mockMode = 'dark';
  const start = jest.fn();
  const stop = jest.fn();
  const timing = jest
    .spyOn(Animated, 'timing')
    .mockReturnValue({ start, stop, reset: jest.fn() } as never);

  // 偏好未知：什么都不做（既不播也不直接满显）。
  const { rerender } = render(<LoginSky width={390} reduceMotion={null} />);
  expect(timing).not.toHaveBeenCalled();

  // 偏好读到 = 不限制动效：播一次入场。
  rerender(<LoginSky width={390} reduceMotion={false} />);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing).toHaveBeenCalledWith(
    expect.any(Animated.Value),
    expect.objectContaining({ toValue: 1, useNativeDriver: true }),
  );
  expect(start).toHaveBeenCalledTimes(1);

  // 之后用户在设置里打开减弱动效：直接跳到终态，不再重播。
  rerender(<LoginSky width={390} reduceMotion />);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(timing).toHaveBeenCalledTimes(1);
});

test('reduce motion on from the start never schedules an animation', () => {
  mockMode = 'dark';
  const timing = jest.spyOn(Animated, 'timing');

  render(<LoginSky width={390} reduceMotion />);

  expect(timing).not.toHaveBeenCalled();
});
