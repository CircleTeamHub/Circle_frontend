import React from 'react';
import {
  fireEvent,
  render,
  screen,
} from '@testing-library/react-native';
import { Platform } from 'react-native';
import { SplitPaneResizer } from './split-pane-resizer';

const mockSetListPaneWidth = jest.fn();
const mockResetListPaneWidth = jest.fn();

jest.mock('@/stores/splitPaneStore', () => ({
  clampListPaneWidth: (width: number) =>
    Math.max(280, Math.min(520, Math.round(width))),
  useSplitPaneStore: (
    selector: (state: {
      setListPaneWidth: typeof mockSetListPaneWidth;
      resetListPaneWidth: typeof mockResetListPaneWidth;
    }) => unknown,
  ) =>
    selector({
      setListPaneWidth: mockSetListPaneWidth,
      resetListPaneWidth: mockResetListPaneWidth,
    }),
}));

jest.mock('@/theme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#6200ee',
      primaryLight: '#eee8ff',
      divider: '#dddddd',
    },
  }),
}));

const originalPlatformOs = Platform.OS;

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'web',
  });
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: originalPlatformOs,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
});

function keyDown(key: string, preventDefault = jest.fn()) {
  fireEvent(screen.getByTestId('split-pane-resizer'), 'keyDown', {
    nativeEvent: { key },
    preventDefault,
  });
  return preventDefault;
}

test('web keyboard controls resize, clamp, jump, and reset the pane', () => {
  const view = render(<SplitPaneResizer paneWidth={336} />);

  expect(screen.getByTestId('split-pane-resizer').props.tabIndex).toBe(0);
  expect(keyDown('ArrowLeft')).toHaveBeenCalledTimes(1);
  expect(mockSetListPaneWidth).toHaveBeenLastCalledWith(312);
  expect(keyDown('ArrowRight')).toHaveBeenCalledTimes(1);
  expect(mockSetListPaneWidth).toHaveBeenLastCalledWith(360);
  expect(keyDown('Home')).toHaveBeenCalledTimes(1);
  expect(mockSetListPaneWidth).toHaveBeenLastCalledWith(280);
  expect(keyDown('End')).toHaveBeenCalledTimes(1);
  expect(mockSetListPaneWidth).toHaveBeenLastCalledWith(520);
  expect(keyDown('Enter')).toHaveBeenCalledTimes(1);
  expect(keyDown(' ')).toHaveBeenCalledTimes(1);
  expect(mockResetListPaneWidth).toHaveBeenCalledTimes(2);

  view.rerender(<SplitPaneResizer paneWidth={280} />);
  keyDown('ArrowLeft');
  expect(mockSetListPaneWidth).toHaveBeenLastCalledWith(280);

  view.rerender(<SplitPaneResizer paneWidth={520} />);
  keyDown('ArrowRight');
  expect(mockSetListPaneWidth).toHaveBeenLastCalledWith(520);
});

test('unknown web keys do not resize, reset, or prevent browser defaults', () => {
  render(<SplitPaneResizer paneWidth={336} />);
  const preventDefault = keyDown('Escape');

  expect(preventDefault).not.toHaveBeenCalled();
  expect(mockSetListPaneWidth).not.toHaveBeenCalled();
  expect(mockResetListPaneWidth).not.toHaveBeenCalled();
});

test('the adjustable exposes its current, minimum, and maximum widths', () => {
  render(<SplitPaneResizer paneWidth={336} />);

  expect(
    screen.getByTestId('split-pane-resizer').props.accessibilityValue,
  ).toEqual({ min: 280, max: 520, now: 336 });
});
