import { Platform } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from './provider';
import { darkColors, lightColors } from './colors';

const mockStored: { mode?: string } = {};
jest.mock('@/storage', () => ({
  storage: {
    getString: () => mockStored.mode,
    set: jest.fn(),
  },
}));

type PageStyle = { style: { backgroundColor?: string } };
const page = () => (globalThis as unknown as { document: { documentElement: PageStyle; body: PageStyle } }).document;

let setMode: (mode: 'light' | 'dark') => void = () => {};
function ModeSwitch() {
  setMode = useTheme().setThemeMode;
  return null;
}

describe('web page background', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    (globalThis as unknown as { document: unknown }).document = {
      documentElement: { style: {} },
      body: { style: {} },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'document');
    delete mockStored.mode;
  });

  test('follows the theme the user picked, not only the system scheme', () => {
    // iOS 的状态栏和 Safari 工具栏按页面底色取色：底色留白的话，深色主题下顶上一条是白的。
    mockStored.mode = 'light';
    render(<ThemeProvider><ModeSwitch /></ThemeProvider>);
    expect(page().documentElement.style.backgroundColor).toBe(lightColors.background);
    expect(page().body.style.backgroundColor).toBe(lightColors.background);

    act(() => setMode('dark'));
    expect(page().documentElement.style.backgroundColor).toBe(darkColors.background);
    expect(page().body.style.backgroundColor).toBe(darkColors.background);
  });
});
