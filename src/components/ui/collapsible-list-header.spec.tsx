import { fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, StyleSheet, Text, View } from 'react-native';
import {
  CollapsibleListHeader,
  collapseTranslations,
} from '@/components/ui/collapsible-list-header';
import {
  INITIAL_SCROLL_TRACKER,
  trackScroll,
  useCollapsibleHeader,
  type CollapsibleHeaderController,
} from '@/hooks/use-collapsible-header';

const TALL = { contentHeight: 3000, viewportHeight: 800 };

describe('trackScroll', () => {
  it('collapses once the list has been read downward past the threshold', () => {
    const first = trackScroll(INITIAL_SCROLL_TRACKER, { offsetY: 5, ...TALL });
    expect(first.collapse).toBeNull();
    const second = trackScroll(first, { offsetY: 12, ...TALL });
    expect(second.collapse).toBe(true);
  });

  it('expands as soon as the list is pulled back by the threshold', () => {
    const down = trackScroll(INITIAL_SCROLL_TRACKER, { offsetY: 600, ...TALL });
    expect(down.collapse).toBe(true);
    // 方向一变就从零累计：600 → 595 只回了 5，不动；再回 4 就展开。
    const smallUp = trackScroll(down, { offsetY: 595, ...TALL });
    expect(smallUp.collapse).toBeNull();
    expect(trackScroll(smallUp, { offsetY: 591, ...TALL }).collapse).toBe(false);
  });

  it('ignores the rubber-band bounce at the bottom of the list', () => {
    const atEnd = trackScroll({ lastY: 2150, travel: 50 }, { offsetY: 2200, ...TALL });
    const overscrolled = trackScroll(atEnd, { offsetY: 2290, ...TALL });
    const bouncedBack = trackScroll(overscrolled, { offsetY: 2200, ...TALL });
    expect(bouncedBack.collapse).not.toBe(false);
  });

  it('ignores pull-to-refresh overscroll at the top', () => {
    const pulled = trackScroll({ lastY: 0, travel: 0 }, { offsetY: -80, ...TALL });
    expect(pulled).toEqual({ lastY: 0, travel: 0, collapse: null });
  });

  it('never collapses when everything fits on one screen', () => {
    const short = trackScroll(INITIAL_SCROLL_TRACKER, {
      offsetY: 40,
      contentHeight: 600,
      viewportHeight: 800,
    });
    expect(short.collapse).toBeNull();
  });
});

const TOP_HEIGHT = 56;
const BODY_HEIGHT = 120;
const PINNED_HEIGHT = 44;

/** 读 Animated 节点当前值（jest 里没有原生侧，只能直接算节点）。 */
function valueOf(node: Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication<number>) {
  return (node as unknown as { __getValue: () => number }).__getValue();
}

describe('collapseTranslations', () => {
  function translationsAt(scrolled: number, progress: number) {
    const translations = collapseTranslations(
      new Animated.Value(scrolled),
      new Animated.Value(progress),
      TOP_HEIGHT,
      BODY_HEIGHT,
    );
    return { top: valueOf(translations.topTranslate), rest: valueOf(translations.restTranslate) };
  }

  it('stays fully open while expanded, wherever the list is', () => {
    const { top, rest } = translationsAt(800, 0);
    expect(rest).toBeCloseTo(0);
    expect(top).toBeCloseTo(0);
  });

  it('collapses the top and body, sliding the pinned row up to the top edge', () => {
    const { top, rest } = translationsAt(800, 1);
    // 其余部分整段上移 top + body（pinned 正好贴到顶边），标题行只退自己的高度。
    expect(rest).toBeCloseTo(-(TOP_HEIGHT + BODY_HEIGHT));
    expect(top).toBeCloseTo(-TOP_HEIGHT);
  });

  it('moves the title row proportionally slower while the rest passes under it', () => {
    const { top, rest } = translationsAt(800, 0.5);
    expect(rest).toBeCloseTo(-(TOP_HEIGHT + BODY_HEIGHT) / 2);
    expect(top).toBeCloseTo(-TOP_HEIGHT / 2);
  });

  it('follows the content near the top instead of opening a gap above the first row', () => {
    const { top, rest } = translationsAt(30, 1);
    expect(rest).toBeCloseTo(-30);
    expect(top).toBeCloseTo((-30 * TOP_HEIGHT) / (TOP_HEIGHT + BODY_HEIGHT));
  });

  it('ignores pull-to-refresh overscroll', () => {
    const { top, rest } = translationsAt(-80, 1);
    expect(rest).toBeCloseTo(0);
    expect(top).toBeCloseTo(0);
  });
});

let latestController: CollapsibleHeaderController | null = null;

function Harness({ enabled = true }: { enabled?: boolean }) {
  const controller = useCollapsibleHeader(enabled);
  latestController = controller;
  return (
    <View style={{ flex: 1 }}>
      <Animated.FlatList
        testID="list"
        data={[]}
        renderItem={() => null}
        onScroll={controller.onScroll}
        progressViewOffset={controller.headerHeight}
        contentContainerStyle={{ paddingTop: controller.headerHeight }}
      />
      <CollapsibleListHeader
        controller={controller}
        top={<Text>top</Text>}
        pinned={<Text>pinned</Text>}
      >
        <Text>body</Text>
      </CollapsibleListHeader>
    </View>
  );
}

function layout(text: string, height: number) {
  fireEvent(screen.getByText(text).parent!, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
  });
}

function scrollTo(offsetY: number) {
  fireEvent.scroll(screen.getByTestId('list'), {
    nativeEvent: {
      contentOffset: { x: 0, y: offsetY },
      contentSize: { width: 390, height: 3000 },
      layoutMeasurement: { width: 390, height: 800 },
    },
  });
}

describe('CollapsibleListHeader', () => {
  let timing: jest.SpyInstance;
  beforeEach(() => {
    timing = jest.spyOn(Animated, 'timing');
  });
  afterEach(() => timing.mockRestore());

  /** 每次启动收起 / 展开动画的目标值：1 收起，0 展开。 */
  const targets = () =>
    timing.mock.calls.map(([, config]) => (config as Animated.TimingAnimationConfig).toValue);

  it('reserves the whole header height at the top of the list', () => {
    render(<Harness />);
    layout('top', TOP_HEIGHT);
    layout('body', BODY_HEIGHT);
    layout('pinned', PINNED_HEIGHT);
    const list = screen.getByTestId('list');
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toEqual(
      expect.objectContaining({ paddingTop: TOP_HEIGHT + BODY_HEIGHT + PINNED_HEIGHT }),
    );
  });

  it('collapses while reading down and comes straight back on the way up', () => {
    render(<Harness />);
    scrollTo(400);
    scrollTo(800);
    expect(targets()).toEqual([1]);
    scrollTo(780);
    expect(targets()).toEqual([1, 0]);
  });

  it('jumps back to the first row without popping a collapsed header open', () => {
    render(<Harness />);
    layout('top', TOP_HEIGHT);
    layout('body', BODY_HEIGHT);
    layout('pinned', PINNED_HEIGHT);
    scrollTo(400);
    scrollTo(800);
    const list = { scrollToOffset: jest.fn() };
    latestController!.scrollToStart(list);
    // 第一行正好贴在吸顶的那一段下面，头部继续收着。
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: TOP_HEIGHT + BODY_HEIGHT, animated: false });
    scrollTo(TOP_HEIGHT + BODY_HEIGHT);
    expect(targets()).toEqual([1]);
  });

  it('jumps back to the very top while the header is open', () => {
    render(<Harness />);
    layout('top', TOP_HEIGHT);
    layout('body', BODY_HEIGHT);
    const list = { scrollToOffset: jest.fn() };
    latestController!.scrollToStart(list);
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
  });

  it('hides the collapsed parts from screen readers but keeps the pinned row', () => {
    render(<Harness />);
    // 读屏看不见的元素，测试库默认也查不到：查询时带上 includeHiddenElements，再看所在分段的 aria-hidden。
    const hidden = (text: string) => {
      let node = screen.getByText(text, { includeHiddenElements: true }).parent;
      while (node && !node.props.onLayout) node = node.parent;
      return Boolean(node!.props['aria-hidden']);
    };
    expect([hidden('top'), hidden('body')]).toEqual([false, false]);
    scrollTo(400);
    scrollTo(800);
    expect([hidden('top'), hidden('body'), hidden('pinned')]).toEqual([true, true, false]);
    expect(screen.queryByText('top')).toBeNull();
    expect(screen.getByText('pinned')).toBeTruthy();
    scrollTo(780);
    expect([hidden('top'), hidden('body')]).toEqual([false, false]);
  });

  it('stays open while disabled (e.g. multi-select)', () => {
    render(<Harness enabled={false} />);
    scrollTo(400);
    scrollTo(800);
    expect(targets()).not.toContain(1);
  });
});
