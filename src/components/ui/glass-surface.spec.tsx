import React from 'react';
import { Platform, Text, View as MockView } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { getAppBlurTarget } from '@/components/app/app-blur-target';
import { GlassSurface } from './glass-surface';

jest.mock('expo-glass-effect', () => ({
  GlassView: (props: object) => <MockView {...props} testID="native-glass" />,
  isGlassEffectAPIAvailable: () => true,
  isLiquidGlassAvailable: () => true,
}));
jest.mock('expo-blur', () => ({
  BlurView: (props: object) => <MockView {...props} testID="native-blur" />,
}));
jest.mock('@/components/app/app-blur-target', () => ({ getAppBlurTarget: jest.fn() }));
jest.mock('@/theme', () => ({
  useTheme: () => ({
    resolvedMode: 'dark',
    colors: { surface: '#1C1C1E', glassBorder: '#FFFFFF', black: '#000000' },
  }),
  withAlpha: jest.requireActual('@/theme/tokens').withAlpha,
}));

afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

test('the iOS composer uses clear glass without covering the messages with another blur layer', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  render(<GlassSurface material="composer" radius={35}><Text>输入</Text></GlassSurface>);
  expect(screen.getByTestId('native-glass').props.glassEffectStyle).toEqual({ style: 'clear', animate: false });
  expect(screen.queryByTestId('native-blur')).toBeNull();
  expect(screen.getByText('输入')).toBeTruthy();
});

test('dialog glass retains its existing regular material and frost', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  render(<GlassSurface material="dialog" radius={24}><Text>对话框</Text></GlassSurface>);
  expect(screen.getByTestId('native-glass').props.glassEffectStyle).toBe('regular');
  expect(screen.getByTestId('native-blur')).toBeTruthy();
});

test('Android blurs the supplied message layer instead of sampling the composer itself', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const messages = React.createRef<MockView>();
  render(<GlassSurface material="composer" radius={35} blurTarget={messages}><Text>输入</Text></GlassSurface>);
  expect(screen.getByTestId('native-blur').props.blurTarget).toBe(messages);
  expect(getAppBlurTarget).not.toHaveBeenCalled();
});
