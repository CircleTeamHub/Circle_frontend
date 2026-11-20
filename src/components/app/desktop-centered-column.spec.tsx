import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, Platform, TextInput } from 'react-native';
import { DesktopCenteredColumn, useContentColumnWidth } from './desktop-centered-column';

jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));

function Draft() {
  const width = useContentColumnWidth();
  const [text, setText] = useState('');
  return <TextInput accessibilityLabel={String(width)} value={text} onChangeText={setText} />;
}

it('uses the device width for screens outside a web column', () => {
  render(<Draft />);
  expect(screen.getByLabelText(String(Dimensions.get('window').width))).toBeTruthy();
});

it('resizes a web column without remounting its form when crossing the desktop breakpoint', () => {
  const originalOS = Platform.OS;
  const window = Dimensions.get('window');
  const deviceScreen = Dimensions.get('screen');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const resize = (width: number) => act(() => {
    Dimensions.set({ window: { ...window, width }, screen: { ...deviceScreen, width } });
  });
  try {
    resize(1200);
    render(<DesktopCenteredColumn><Draft /></DesktopCenteredColumn>);
    fireEvent.changeText(screen.getByLabelText('640'), 'draft');
    for (const width of [768, 390, 1440]) {
      resize(width);
      expect(screen.getByLabelText(String(Math.min(width, 640))).props.value).toBe('draft');
    }
  } finally {
    act(() => Dimensions.set({ window, screen: deviceScreen }));
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  }
});
