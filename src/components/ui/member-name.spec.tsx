import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import type { ContextType, ReactNode } from 'react';
import { AccessibilityInfo, AppState, Dimensions, StyleSheet } from 'react-native';
import { Canvas, LinearGradient, Paragraph } from '@shopify/react-native-skia';
import { MemberName } from './member-name';
import { MemberNameAnimationProvider } from './member-name-animation';
import { MemberNameFlow as WebMemberNameFlow } from './member-name-flow.web';

// 这份测的是「会员名流光为什么曾经让手机发烫」的回归:
// 旧实现逐字 useAnimatedStyle 改文字颜色,每帧都要整棵布局树重新提交、文字重排。
// 现在流光交给 Skia 在 UI 线程直接画 —— React 这边只能有派生值,不能有动画样式;
// 列表默认静态;页面看不见时时钟要停。
jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  const state = {
    running: false,
    animatedStyleCalls: 0,
    clock: null as { value: number } | null,
  };
  return {
    // 没有 __esModule 的话 `import Animated from` 拿到的是整个对象,Animated.Text 为 undefined,
    // 旧实现会直接崩在渲染上,永远走不到下面那些真正的断言。
    __esModule: true,
    __state: state,
    default: { Text: ReactNative.Text, View: ReactNative.View },
    useSharedValue: (initial: number) => {
      const [shared] = ReactModule.useState(() => ({ value: initial }));
      state.clock = shared;
      return shared;
    },
    // 惰性求值:读 .value 时才按当下的时钟算,和 UI 线程上的映射一致。
    useDerivedValue: <T,>(updater: () => T) => ({
      get value() {
        return updater();
      },
    }),
    useAnimatedStyle: () => {
      state.animatedStyleCalls += 1;
      return {};
    },
    interpolateColor: () => '#000000',
    withTiming: (toValue: number) => toValue,
    withRepeat: (value: number) => {
      state.running = true;
      return value;
    },
    cancelAnimation: () => {
      state.running = false;
    },
    Easing: { linear: (t: number) => t },
  };
});

jest.mock('@/stores/userVipStore', () => ({
  useUserVipLevel: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const reanimated = require('react-native-reanimated') as {
  __state: {
    running: boolean;
    animatedStyleCalls: number;
    clock: { value: number } | null;
  };
};

interface BuiltTextStyle {
  fontSize?: number;
  fontFamilies?: string[];
  fontStyle?: { weight?: number };
}

interface BuiltParagraph {
  paragraphStyle: { maxLines?: number; textAlign?: number };
  textStyles: BuiltTextStyle[];
  text: string;
  layoutWidth?: number;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const skiaMock = require('@shopify/react-native-skia') as {
  __builtParagraphs: BuiltParagraph[];
};

const SUPER = 4;
const FLOW_START = '#D9A85E';

type NavigationListener = () => void;

/** 足够让 MemberName 判断「这一页在不在前台」的导航桩。 */
function createScreenNavigation(initiallyFocused: boolean) {
  let focused = initiallyFocused;
  const listeners: Record<'focus' | 'blur', Set<NavigationListener>> = {
    focus: new Set(),
    blur: new Set(),
  };
  const navigation = {
    isFocused: () => focused,
    addListener: (type: 'focus' | 'blur', listener: NavigationListener) => {
      listeners[type].add(listener);
      return () => listeners[type].delete(listener);
    },
  };
  return {
    navigation: navigation as unknown as NonNullable<
      ContextType<typeof NavigationContext>
    >,
    setFocused(next: boolean) {
      focused = next;
      listeners[next ? 'focus' : 'blur'].forEach((listener) => listener());
    },
    listenerCount: () => listeners.focus.size + listeners.blur.size,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return <MemberNameAnimationProvider>{children}</MemberNameAnimationProvider>;
}

let reduceMotion: Promise<boolean>;

async function flushPreferences() {
  await act(async () => {
    await reduceMotion;
  });
}

function layoutPlaceholder(name: string, width: number, height: number) {
  fireEvent(screen.getByText(name), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  });
}

/** 原生排版回报的行信息:Skia 字宽要以它为准。 */
function measurePlaceholder(name: string, lines: { width: number; text: string }[]) {
  fireEvent(screen.getByText(name), 'textLayout', { nativeEvent: { lines } });
}

beforeEach(() => {
  reanimated.__state.running = false;
  reanimated.__state.animatedStyleCalls = 0;
  reanimated.__state.clock = null;
  skiaMock.__builtParagraphs.length = 0;
  reduceMotion = Promise.resolve(false);

  Object.defineProperty(AppState, 'currentState', {
    value: 'active',
    configurable: true,
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(
      () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
    );
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => reduceMotion);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation(
      () =>
        ({ remove: () => {} }) as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >,
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MemberName super tier', () => {
  test('defaults to a static gradient: lists never start the clock or a canvas', async () => {
    render(
      <Providers>
        <MemberName name="小霸王" vipLevel={SUPER} />
      </Providers>,
    );
    await flushPreferences();

    expect(screen.UNSAFE_queryAllByType(Canvas)).toHaveLength(0);
    expect(reanimated.__state.running).toBe(false);
    expect(reanimated.__state.animatedStyleCalls).toBe(0);
    // 静态渐变仍然逐字上色:第一个字取色带起点。
    expect(StyleSheet.flatten(screen.getByText('小').props.style)).toEqual({
      color: FLOW_START,
    });
  });

  test('animated names are painted by Skia, never by per-frame React styles', async () => {
    render(
      <Providers>
        <MemberName name="小霸王" vipLevel={SUPER} animated />
      </Providers>,
    );
    await flushPreferences();
    layoutPlaceholder('小霸王', 200, 28);

    expect(reanimated.__state.running).toBe(true);
    // 回归点:任何 useAnimatedStyle 都意味着每帧一次布局树提交。
    expect(reanimated.__state.animatedStyleCalls).toBe(0);
    expect(screen.UNSAFE_getAllByType(Canvas)).toHaveLength(1);

    const gradient = screen.UNSAFE_getByType(LinearGradient).props;
    expect(gradient.mode).toBe('repeat');
    expect(gradient.colors[0]).toBe(FLOW_START);
    // start/end 是 UI 线程上的派生值,而不是每次渲染算好的固定坐标。
    expect(gradient.start).toHaveProperty('value');
    expect(gradient.end).toHaveProperty('value');

    // 原生 Text 只占位 + 供读屏朗读,字本身透明,不和 Skia 画的字叠出重影。
    const placeholder = screen.getByText('小霸王');
    expect(StyleSheet.flatten(placeholder.props.style).color).toBe('transparent');
  });

  test('one clock cycle shifts the gradient by exactly one text width, so the loop is seamless', async () => {
    render(
      <Providers>
        <MemberName name="小霸王" vipLevel={SUPER} animated />
      </Providers>,
    );
    await flushPreferences();
    layoutPlaceholder('小霸王', 200, 28);

    const clock = reanimated.__state.clock;
    expect(clock).not.toBeNull();
    const { start, end } = screen.UNSAFE_getByType(LinearGradient).props;
    const longestLine = 80; // 来自 Skia 桩的段落宽度

    clock!.value = 0;
    expect(start.value.x).toBeCloseTo(0);
    expect(end.value.x - start.value.x).toBeCloseTo(longestLine);

    clock!.value = 0.5;
    expect(start.value.x).toBeCloseTo(-longestLine / 2);
    expect(end.value.x - start.value.x).toBeCloseTo(longestLine);

    clock!.value = 1;
    expect(start.value.x).toBeCloseTo(-longestLine);
  });

  test('the Skia paragraph mirrors the caller text style with the system font', async () => {
    render(
      <Providers>
        <MemberName
          name="小霸王"
          vipLevel={SUPER}
          animated
          numberOfLines={1}
          style={{ fontSize: 20, fontWeight: '700', textAlign: 'center' }}
        />
      </Providers>,
    );
    await flushPreferences();
    layoutPlaceholder('小霸王', 200, 28);

    const built = skiaMock.__builtParagraphs.at(-1);
    expect(built?.text).toBe('小霸王');
    // 按占位框宽度排(外加 1pt 防亚像素折行的余量)。
    expect(built?.layoutWidth).toBeGreaterThanOrEqual(200);
    expect(built?.layoutWidth).toBeLessThanOrEqual(202);
    expect(built?.paragraphStyle.maxLines).toBe(1);
    expect(built?.paragraphStyle.textAlign).toBe(2); // TextAlign.Center
    const textStyle = built?.textStyles[0];
    // 原生 Text 默认跟随系统字号放大,Skia 画的字必须同步放大才对得上占位框。
    expect(textStyle?.fontSize).toBe(20 * Dimensions.get('window').fontScale);
    expect(textStyle?.fontStyle?.weight).toBe(700);
    expect(textStyle?.fontFamilies?.length).toBeGreaterThan(0);

    expect(screen.UNSAFE_getByType(Paragraph)).toBeTruthy();
  });

  test('Skia glyphs are sized to the width the native layout measured, not a recomputed scale', async () => {
    // Android 14 起系统大字号是非线性放大的,而 JS 的 fontScale 是线性的:
    // 自己按 fontScale 放大的话 Skia 的字比占位框宽,折到第二行后被画布裁掉。
    render(
      <Providers>
        <MemberName name="小霸王" vipLevel={SUPER} animated style={{ fontSize: 20 }} />
      </Providers>,
    );
    await flushPreferences();
    layoutPlaceholder('小霸王', 200, 28);
    measurePlaceholder('小霸王', [{ width: 60, text: '小霸王' }]);

    const nominal = 20 * Dimensions.get('window').fontScale;
    const fitted = skiaMock.__builtParagraphs.at(-1)?.textStyles[0]?.fontSize;
    // Skia 桩的段落自然宽度是 80,原生量到 60 → 字号按 0.75 收。
    expect(fitted).toBeCloseTo(nominal * 0.75);
  });

  test('a truncated native layout is not used for fitting; Skia ellipsizes on its own', async () => {
    render(
      <Providers>
        <MemberName
          name="小霸王"
          vipLevel={SUPER}
          animated
          numberOfLines={1}
          style={{ fontSize: 20 }}
        />
      </Providers>,
    );
    await flushPreferences();
    layoutPlaceholder('小霸王', 40, 28);
    // 原生量到的是截断后的宽度,拿它来缩字号会把整个名字缩小塞进去。
    measurePlaceholder('小霸王', [{ width: 40, text: '小…' }]);

    const last = skiaMock.__builtParagraphs.at(-1);
    expect(last?.textStyles[0]?.fontSize).toBe(20 * Dimensions.get('window').fontScale);
    expect(last?.paragraphStyle.maxLines).toBe(1);
  });

  test('the name stays visible until the Skia canvas can paint it', async () => {
    render(
      <Providers>
        <MemberName name="小霸王" vipLevel={SUPER} animated />
      </Providers>,
    );
    await flushPreferences();

    // 还没量到框、画布还没挂:占位字不能是透明的,否则首帧名字是空白。
    const before = StyleSheet.flatten(screen.getByText('小霸王').props.style);
    expect(before.color).toBe(FLOW_START);

    layoutPlaceholder('小霸王', 200, 28);
    const after = StyleSheet.flatten(screen.getByText('小霸王').props.style);
    expect(after.color).toBe('transparent');
  });

  test('the canvas renders in sRGB so the palette matches the static gradient', async () => {
    render(
      <Providers>
        <MemberName name="小霸王" vipLevel={SUPER} animated />
      </Providers>,
    );
    await flushPreferences();
    layoutPlaceholder('小霸王', 200, 28);

    expect(screen.UNSAFE_getByType(Canvas).props.colorSpace).toBe('srgb');
  });

  test('box styles stay on the wrapper so the canvas lines up with the glyphs', async () => {
    render(
      <Providers>
        <MemberName
          name="小霸王"
          vipLevel={SUPER}
          animated
          style={{ fontSize: 20, marginTop: 8, paddingHorizontal: 4, opacity: 0.9 }}
        />
      </Providers>,
    );
    await flushPreferences();

    const placeholder = StyleSheet.flatten(screen.getByText('小霸王').props.style);
    expect(placeholder.fontSize).toBe(20);
    // 内边距若留在占位 Text 上,字会相对画布偏移;透明度留在上面则只作用于透明的占位字。
    expect(placeholder).not.toHaveProperty('marginTop');
    expect(placeholder).not.toHaveProperty('paddingHorizontal');
    expect(placeholder).not.toHaveProperty('opacity');
  });

  test('names with colour emoji keep the static gradient instead of a masked silhouette', async () => {
    render(
      <Providers>
        <MemberName name="🌸小明" vipLevel={SUPER} animated />
      </Providers>,
    );
    await flushPreferences();

    // 流光把名字字形当遮罩,会把彩色 emoji 涂成一块渐变剪影。
    expect(screen.UNSAFE_queryAllByType(Canvas)).toHaveLength(0);
    expect(reanimated.__state.running).toBe(false);
  });

  test('Reduce Motion keeps the static gradient even where animation is requested', async () => {
    reduceMotion = Promise.resolve(true);
    render(
      <Providers>
        <MemberName name="小霸王" vipLevel={SUPER} animated />
      </Providers>,
    );
    await flushPreferences();

    expect(screen.UNSAFE_queryAllByType(Canvas)).toHaveLength(0);
    expect(reanimated.__state.running).toBe(false);
  });

  test('the clock stops while the hosting screen is hidden and resumes when it returns', async () => {
    const screenNav = createScreenNavigation(true);
    render(
      <Providers>
        <NavigationContext.Provider value={screenNav.navigation}>
          <MemberName name="小霸王" vipLevel={SUPER} animated />
        </NavigationContext.Provider>
      </Providers>,
    );
    await flushPreferences();
    expect(reanimated.__state.running).toBe(true);

    // tab 切走 / 上面压了新页面:页面并不卸载,但不该再烧电。
    await act(async () => {
      screenNav.setFocused(false);
    });
    expect(reanimated.__state.running).toBe(false);

    await act(async () => {
      screenNav.setFocused(true);
    });
    expect(reanimated.__state.running).toBe(true);
  });

  test('a name on a screen that starts hidden never starts the clock', async () => {
    const screenNav = createScreenNavigation(false);
    render(
      <Providers>
        <NavigationContext.Provider value={screenNav.navigation}>
          <MemberName name="小霸王" vipLevel={SUPER} animated />
        </NavigationContext.Provider>
      </Providers>,
    );
    await flushPreferences();
    expect(reanimated.__state.running).toBe(false);
  });

  test('static names do not subscribe to screen focus at all', async () => {
    const screenNav = createScreenNavigation(true);
    render(
      <Providers>
        <NavigationContext.Provider value={screenNav.navigation}>
          <MemberName name="小霸王" vipLevel={SUPER} />
          <MemberName name="法兰克" vipLevel={SUPER} />
        </NavigationContext.Provider>
      </Providers>,
    );
    await flushPreferences();
    // 列表里几十个名字,每个都挂 focus/blur 监听是白花的开销。
    expect(screenNav.listenerCount()).toBe(0);
  });
});

describe('MemberNameFlow on web', () => {
  test('falls back to per-character interpolation driven by the shared clock', () => {
    // Web 没有加载 CanvasKit;浏览器里逐字插值只触发重绘,不走 React 提交。
    const clock = { value: 0 };
    render(
      <WebMemberNameFlow
        name="小霸王"
        colors={['#D9A85E', '#D97795', '#D9A85E']}
        progress={clock as unknown as Parameters<typeof WebMemberNameFlow>[0]['progress']}
      />,
    );

    expect(screen.getByText('小')).toBeTruthy();
    expect(screen.getByText('霸')).toBeTruthy();
    expect(screen.getByText('王')).toBeTruthy();
    expect(reanimated.__state.animatedStyleCalls).toBe(3);
  });
});
