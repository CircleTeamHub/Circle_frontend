import { indicatorSlideStart } from './tab-indicator-track';

// 回归:每个 tab 首页各画一份 bar(见 TabRootScreen),各自只记得自己上次看见指示器停在哪。
// 在探索切去「我的」时,探索那份(失焦前最后一次渲染)把指示器挪到了「我的」;之后从消息点进探索,
// 探索那份从「我的」往左滑过来 —— 方向反了。指示器从哪里滑过来要按全局记:用户上一次看见它停在哪。

const MESSAGES = 0;
const CONTACTS = 1;
const EXPLORE = 2;
const PROFILE = 3;
const TABS = 'tabs-1';

type Bar = { current: number };
const bar = (): Bar => ({ current: -1 });

// 模块里的记录是全局的,每条用例从一个干净的模块开始。
let start: typeof indicatorSlideStart;
beforeEach(() => {
  jest.isolateModules(() => {
    start = (jest.requireActual('./tab-indicator-track') as typeof import('./tab-indicator-track')).indicatorSlideStart;
  });
});

test('the first bar the user sees does not slide in', () => {
  expect(start(MESSAGES, bar(), TABS)).toBeNull();
});

test('switching tabs slides from the tab the user came from, whichever bar renders first', () => {
  const messages = bar();
  const profile = bar();
  start(MESSAGES, messages, TABS);

  // 消息那份失焦前的最后一次渲染、和「我的」那份,在同一次提交里先后跑。
  expect(start(PROFILE, messages, TABS)).toBe(MESSAGES);
  expect(start(PROFILE, profile, TABS)).toBe(MESSAGES);
});

test('a bar that last saw another tab still slides from where the user actually came from', () => {
  const messages = bar();
  const explore = bar();
  const profile = bar();
  start(MESSAGES, messages, TABS);
  start(EXPLORE, messages, TABS);
  start(EXPLORE, explore, TABS);
  // 探索 → 我的:探索那份失焦前把指示器挪到了「我的」。
  start(PROFILE, explore, TABS);
  start(PROFILE, profile, TABS);
  // 我的 → 消息。
  start(MESSAGES, profile, TABS);
  start(MESSAGES, messages, TABS);

  // 消息 → 探索:要从左边的消息滑过来,不是从右边的「我的」。
  expect(start(EXPLORE, messages, TABS)).toBe(MESSAGES);
  expect(start(EXPLORE, explore, TABS)).toBe(MESSAGES);
});

test('coming back from the circles button to the same tab does not slide', () => {
  const explore = bar();
  start(MESSAGES, bar(), TABS);
  start(EXPLORE, explore, TABS);
  // 圈子不在 bar 里,选中时指示器隐藏、不记录;回到探索,指示器原地出现。
  expect(start(EXPLORE, explore, TABS)).toBeNull();
});

test('leaving the circles button for another tab slides from the tab before it', () => {
  const explore = bar();
  const contacts = bar();
  start(MESSAGES, bar(), TABS);
  start(EXPLORE, explore, TABS);
  // 探索 → 圈子 → 联系人:从探索那一格滑过来。
  expect(start(CONTACTS, contacts, TABS)).toBe(EXPLORE);
});

test('re-rendering the same bar on the same tab (layout change) does not slide again', () => {
  const contacts = bar();
  start(MESSAGES, bar(), TABS);
  expect(start(CONTACTS, contacts, TABS)).toBe(MESSAGES);
  expect(start(CONTACTS, contacts, TABS)).toBeNull();
});

// 回归:退出再登录(或添加账号)后 tabs 重建,记录还停在上个会话;新会话第一眼就看到指示器
// 带着拉伸动画从上个会话停的那一格滑过来。换了一份 tabs 导航器就当首次出现。
test('a rebuilt tabs navigator starts fresh instead of sliding from the previous session', () => {
  start(MESSAGES, bar(), TABS);
  start(PROFILE, bar(), TABS);

  expect(start(MESSAGES, bar(), 'tabs-2')).toBeNull();
});
