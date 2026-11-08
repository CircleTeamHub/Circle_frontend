import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Animated, PanResponder, StyleSheet, Text } from 'react-native';
import { BottomSheetFlatList, BottomSheetModal } from './bottom-sheet-modal';

jest.mock('@/components/app/UploadProgressHost', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { UploadProgressHost: () => <View testID="upload-progress-modal-host" /> };
});

jest.mock('@/theme', () => ({
  useTheme: () => ({ colors: { overlay: 'overlay-token' } }),
}));

jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    KeyboardAvoidingContainer: ({ children, ...props }: { children: React.ReactNode; testID?: string; pointerEvents?: 'box-none' }) => (
      <View {...props}>{children}</View>
    ),
  };
});

type Gesture = { dx: number; dy: number; vy: number; y0: number };
type Handlers = {
  onStartShouldSetPanResponderCapture: (event: { nativeEvent: { pageY: number } }, gesture: Gesture) => boolean;
  onMoveShouldSetPanResponder: (event: unknown, gesture: Gesture) => boolean;
  onMoveShouldSetPanResponderCapture: (event: unknown, gesture: Gesture) => boolean;
  onPanResponderMove: (event: unknown, gesture: Gesture) => void;
  onPanResponderRelease: (event: unknown, gesture: Gesture) => void;
};

let handlers: Handlers;

const createSpy = jest
  .spyOn(PanResponder, 'create')
  .mockImplementation((config) => {
    handlers = config as unknown as Handlers;
    return { panHandlers: {} } as ReturnType<typeof PanResponder.create>;
  });
// Run the dismiss animation's completion synchronously.
const timingSpy = jest.spyOn(Animated, 'timing').mockImplementation(
  () =>
    ({
      start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
    }) as Animated.CompositeAnimation,
);

const springSpy = jest.spyOn(Animated, 'spring').mockImplementation(
  () => ({ start: () => undefined }) as unknown as Animated.CompositeAnimation,
);

afterAll(() => {
  createSpy.mockRestore();
  timingSpy.mockRestore();
  springSpy.mockRestore();
});

function renderSheetAt(top: number, onClose = jest.fn()) {
  render(
    <BottomSheetModal visible onClose={onClose}>
      <Text>content</Text>
    </BottomSheetModal>,
  );
  fireEvent(screen.getByTestId('bottom-sheet-content'), 'layout', {
    nativeEvent: { layout: { x: 0, y: top, width: 390, height: 400 } },
  });
  return onClose;
}

function touchDown(startY: number) {
  handlers.onStartShouldSetPanResponderCapture({ nativeEvent: { pageY: startY } }, { dx: 0, dy: 0, vy: 0, y0: 0 });
}

/**
 * 接管判定时 PanResponder 真实给出的手势:y0 要到接管时才赋值,这时还是 0。
 * 回归:按 y0 判定「起点在顶部」恒成立,正文里手指稍一下滑,点按就被面板抢走。
 */
function claim(
  phase: 'onMoveShouldSetPanResponder' | 'onMoveShouldSetPanResponderCapture',
  startY: number,
  movement: { dx: number; dy: number },
) {
  touchDown(startY);
  return handlers[phase]({}, { ...movement, vy: 0, y0: 0 });
}

/** Drive the real handler sequence the responder system would call. */
function drag(y0: number, dy: number, vy = 0) {
  act(() => {
    touchDown(y0);
    handlers.onPanResponderMove({}, { dx: 0, dy, vy, y0 });
    handlers.onPanResponderRelease({}, { dx: 0, dy, vy, y0 });
  });
}

test('a downward drag from the header claims the gesture and dismisses the sheet', () => {
  const onClose = renderSheetAt(400);
  expect(claim('onMoveShouldSetPanResponder', 420, { dx: 0, dy: 20 })).toBe(true);
  drag(420, 200);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a drag that starts in the body never moves or dismisses the sheet', () => {
  const onClose = renderSheetAt(400);
  expect(claim('onMoveShouldSetPanResponder', 600, { dx: 0, dy: 120 })).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
});

// 回归:面板按下就成为 JS responder 的话,iOS 新架构下里面的 ScrollView 不让滚(祖先是 responder),
// 手指落在纯文字或不可点的行上时列表滑不动。
test('the sheet does not take the touch when a finger lands on it', () => {
  renderSheetAt(400);
  const { onStartShouldSetResponder } = screen.getByTestId('bottom-sheet-content').props;
  expect(onStartShouldSetResponder?.() ?? false).toBe(false);
});

// 面板不再按下就抢 responder,所以蒙层不能包着面板,否则点面板上的空白会冒泡成「点蒙层」。
test('the backdrop sits behind the sheet instead of wrapping it', () => {
  renderSheetAt(400);
  expect(within(screen.getByTestId('bottom-sheet-backdrop')).queryByText('content')).toBeNull();
  expect(screen.getByText('content')).toBeTruthy();
});

test.each([true, false])('touches outside the sheet reach the backdrop (avoidKeyboard=%s)', (avoidKeyboard) => {
  const onClose = jest.fn();
  render(<BottomSheetModal visible onClose={onClose} avoidKeyboard={avoidKeyboard}><Text>content</Text></BottomSheetModal>);
  expect(screen.getByTestId('bottom-sheet-area').props.pointerEvents).toBe('box-none');
  fireEvent.press(screen.getByTestId('bottom-sheet-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('closeOnBackdropPress=false leaves the backdrop inert', () => {
  const onClose = jest.fn();
  render(<BottomSheetModal visible onClose={onClose} closeOnBackdropPress={false}><Text>content</Text></BottomSheetModal>);
  fireEvent.press(screen.getByTestId('bottom-sheet-backdrop'));
  expect(onClose).not.toHaveBeenCalled();
});

// 接管时 dy 已经清零,再减一次激活距离,手指要多走 10pt 面板才动,关闭门槛也跟着偏高。
test('the drag is measured from the moment the sheet takes the gesture', () => {
  const onClose = renderSheetAt(400);
  drag(420, 125);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('horizontal or upward drags on the header are not treated as dismiss', () => {
  renderSheetAt(400);
  expect(claim('onMoveShouldSetPanResponder', 420, { dx: 40, dy: 10 })).toBe(false);
  expect(claim('onMoveShouldSetPanResponder', 420, { dx: 0, dy: -20 })).toBe(false);
});

// 回归:接管时 y0 是当时手指的位置,不是起点。从标题栏按钮上快速下甩,第一次移动就越过了
// 把手区域,按 y0 判定的话面板没有反应。
test('a fast flick that starts on a header button still drags the sheet', () => {
  const onClose = renderSheetAt(400);
  expect(claim('onMoveShouldSetPanResponderCapture', 420, { dx: 0, dy: 80 })).toBe(true);
  act(() => {
    handlers.onPanResponderMove({}, { dx: 0, dy: 200, vy: 0, y0: 500 });
    handlers.onPanResponderRelease({}, { dx: 0, dy: 200, vy: 0, y0: 500 });
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a short or gentle header drag springs back instead of dismissing', () => {
  const onClose = renderSheetAt(400);
  // 拖出 90pt 没过 120 的门槛；快甩但只拖出 30pt 也不算。
  drag(420, 100);
  drag(420, 40, 3);
  expect(onClose).not.toHaveBeenCalled();
});

function renderListSheetAt(top: number, onClose = jest.fn()) {
  render(
    <BottomSheetModal visible onClose={onClose}>
      <BottomSheetFlatList
        testID="sheet-list"
        data={['a', 'b']}
        keyExtractor={(item) => item}
        renderItem={({ item }) => <Text>{item}</Text>}
      />
    </BottomSheetModal>,
  );
  fireEvent(screen.getByTestId('bottom-sheet-content'), 'layout', {
    nativeEvent: { layout: { x: 0, y: top, width: 390, height: 400 } },
  });
  return onClose;
}

function scrollListTo(y: number) {
  fireEvent.scroll(screen.getByTestId('sheet-list'), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: 2000 },
      layoutMeasurement: { width: 390, height: 300 },
    },
  });
}

test('with its list at the top, a body drag pins the list and moves the sheet', () => {
  const onClose = renderListSheetAt(400);
  expect(claim('onMoveShouldSetPanResponderCapture', 600, { dx: 0, dy: 20 })).toBe(true);
  drag(600, 200);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('while its list is scrolled down, a body drag scrolls the list and leaves the sheet alone', () => {
  const onClose = renderListSheetAt(400);
  scrollListTo(240);
  expect(claim('onMoveShouldSetPanResponderCapture', 600, { dx: 0, dy: 40 })).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  // 把手区域始终可拖。
  expect(claim('onMoveShouldSetPanResponderCapture', 420, { dx: 0, dy: 20 })).toBe(true);
});

// 面板常和页面同底色(个人资料编辑就是),背后不压暗的话两者分不出边界。
test('dims the page behind the sheet by default', () => {
  render(
    <BottomSheetModal visible onClose={jest.fn()}>
      <Text>content</Text>
    </BottomSheetModal>,
  );
  const style = StyleSheet.flatten(screen.getByTestId('bottom-sheet-backdrop').props.style);
  expect(style.backgroundColor).toBe('overlay-token');
});

test('a caller backdropStyle still overrides the default dim', () => {
  render(
    <BottomSheetModal visible onClose={jest.fn()} backdropStyle={{ backgroundColor: 'red' }}>
      <Text>content</Text>
    </BottomSheetModal>,
  );
  const style = StyleSheet.flatten(screen.getByTestId('bottom-sheet-backdrop').props.style);
  expect(style.backgroundColor).toBe('red');
});

test('keeps upload progress visible inside its existing native modal', () => {
  render(<BottomSheetModal visible onClose={jest.fn()}><Text>content</Text></BottomSheetModal>);
  expect(screen.getByTestId('upload-progress-modal-host')).toBeTruthy();
});
