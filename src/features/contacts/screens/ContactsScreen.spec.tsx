import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import ContactsScreen from './ContactsScreen';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

jest.mock('@/theme', () => ({
  Radius: { lg: 16, full: 9999 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  Typography: { title: {}, caption: {}, tiny: {}, bodyRegular: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', text: '#111', textSecondary: '#666', primary: '#00f', white: '#fff', indexBubble: '#ccc',
    },
  }),
}));

jest.mock('@/services/api/friends', () => ({
  fetchFriends: jest.fn(),
  friendsMutatedSince: () => false,
}));

// 门控对象必须稳定:每次渲染换新对象会让 loadFriends 换引用、聚焦回调反复重跑。
jest.mock('@/hooks/use-focus-reload-gate', () => {
  const gate = { shouldSkip: () => false, markLoaded: () => undefined };
  return { useFocusReloadGate: () => gate };
});

jest.mock('@/stores/authStore', () => {
  const state = { sessionEpoch: 1, user: { id: 'me' } };
  return {
    useAuthStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});

jest.mock('@/stores/friendActivityUnreadStore', () => {
  const state = { count: 0, countKnown: true, refresh: () => Promise.resolve() };
  return {
    useFriendActivityUnreadStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

jest.mock('@/stores/tabBadgeStore', () => {
  const state = { groupAdmissionsUnread: 0 };
  return { useTabBadgeStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

jest.mock('@/chat-core/store', () => {
  const state = { syncPeerAvatars: () => undefined };
  return { useChatStore: { getState: () => state } };
});

jest.mock('@/services/api/group-admissions', () => ({
  refreshGroupAdmissionUnread: () => Promise.resolve(),
}));
jest.mock('@/storage/page-snapshots', () => ({ readPageSnapshot: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/search-bar', () => ({ SearchBar: () => null }));
jest.mock('@/components/ui/menu-row', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MenuRow: ({ label }: { label: string }) => ReactModule.createElement(Text, null, label) };
});
jest.mock('@/components/ui/member-name', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MemberName: ({ name }: { name: string }) => ReactModule.createElement(Text, null, name),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const friend = (id: string, nickname: string, accountId = id): FriendProfile => ({
  id,
  accountId,
  nickname,
  avatarUrl: null,
  avatarFrameAppearance: null,
  friendsSince: '2026-01-01T00:00:00.000Z',
  remark: null,
});

// 分组:A[Amy, Ann] B[Bob] C[Cat] Z[Zed] #[007] —— 没有 D–Y 的好友。
const FRIENDS = [
  friend('u-zed', 'Zed'),
  friend('u-bob', 'Bob'),
  friend('u-ann', 'Ann'),
  friend('u-amy', 'Amy'),
  friend('u-cat', 'Cat'),
  friend('u-num', '007', '007'),
];
const LETTERS = ['A', 'B', 'C', 'Z', '#'];
// 索引条上每个字母占的高度(区域还没量到时的默认值)。
const LETTER_HEIGHT = 16;
const LIST_HEADER_HEIGHT = 300;

const scrollTo = jest.mocked(ScrollView.prototype.scrollTo);

function setFontScale(fontScale: number) {
  const size = { width: 390, height: 844, scale: 3, fontScale };
  act(() => {
    Dimensions.set({ window: size, screen: size });
  });
}

function touchAt(letterIndex: number, pageOffset = 400) {
  const locationY = letterIndex * LETTER_HEIGHT + LETTER_HEIGHT / 2;
  return { nativeEvent: { locationY, pageY: pageOffset + locationY } };
}

// 气泡只是给手指的视觉反馈,对读屏隐藏(读屏用户聚焦字母本身就会读出来)。
const bubble = () => screen.queryByTestId('contacts-index-bubble', { includeHiddenElements: true });

/** 气泡贴在索引条左边,竖直方向的中心对准当前字母的中心。 */
function expectBubbleBeside(letterIndex: number, letter: string) {
  const element = bubble();
  expect(element).toHaveTextContent(letter);
  const { top, height } = StyleSheet.flatten(element?.props.style) as { top: number; height: number };
  expect(top + height / 2).toBe(letterIndex * LETTER_HEIGHT + LETTER_HEIGHT / 2);
}

function heightOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).height as number;
}

async function renderContacts() {
  render(<ContactsScreen />);
  await screen.findByText('Zed');
  fireEvent(screen.getByTestId('contacts-list-header'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: LIST_HEADER_HEIGHT } },
  });
  scrollTo.mockClear();
}

/** 第 sectionIndex 组的标题在内容里的 y:列表头 + 前面每组(标题 + 各行)。 */
function sectionTop(sectionIndex: number) {
  const headerHeight = heightOf('contacts-section-A');
  const rowHeight = heightOf('contacts-row-u-bob');
  const rowsBefore = [2, 1, 1, 1, 1].slice(0, sectionIndex).reduce((sum, n) => sum + n, 0);
  return LIST_HEADER_HEIGHT + sectionIndex * headerHeight + rowsBefore * rowHeight;
}

beforeEach(() => {
  setFontScale(1);
  jest.mocked(fetchFriends).mockReset().mockResolvedValue(FRIENDS);
  jest.mocked(Haptics.selectionAsync).mockClear();
});

test('the index lists only letters that have contacts, each readable by screen readers', async () => {
  await renderContacts();

  const letters = screen.getAllByRole('button', { name: /^([A-Z]|#)$/ });
  expect(letters.map((letter) => letter.props.accessibilityLabel)).toEqual(LETTERS);
  expect(letters[0].props.accessibilityHint).toBe('contacts.indexJumpHint');
});

test('tapping a letter lands its section header at the top of the list and pops a bubble beside it', async () => {
  await renderContacts();
  const bar = screen.getByTestId('contacts-index-bar');

  fireEvent(bar, 'responderGrant', touchAt(3));

  // Z 是第 4 组:前面有 A(2 人)、B、C 三组。
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenLastCalledWith({ y: sectionTop(3), animated: false });
  expect(sectionTop(3)).toBe(LIST_HEADER_HEIGHT + 3 * 32 + 4 * 68);
  expectBubbleBeside(3, 'Z');
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

  fireEvent(bar, 'responderRelease', touchAt(3));
  expect(bubble()).toBeNull();
});

test('sliding along the index jumps once per letter crossed and clamps at both ends', async () => {
  await renderContacts();
  const bar = screen.getByTestId('contacts-index-bar');
  const start = touchAt(0);
  const moveTo = (y: number) =>
    fireEvent(bar, 'responderMove', {
      // 手指滑出索引条时 locationY 会换参照物,所以只看 pageY 的位移。
      nativeEvent: { locationY: -999, pageY: start.nativeEvent.pageY + y },
    });

  fireEvent(bar, 'responderGrant', start);
  moveTo(4); // 仍在 A 里,不重复跳
  moveTo(LETTER_HEIGHT); // B
  moveTo(LETTER_HEIGHT * 2); // C
  expectBubbleBeside(2, 'C');
  moveTo(1000); // 拖过底端 → 停在最后一个 #
  moveTo(-1000); // 拖过顶端 → 回到 A

  expect(scrollTo.mock.calls.map(([params]) => params)).toEqual([
    { y: sectionTop(0), animated: false },
    { y: sectionTop(1), animated: false },
    { y: sectionTop(2), animated: false },
    { y: sectionTop(4), animated: false },
    { y: sectionTop(0), animated: false },
  ]);
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(5);
  expectBubbleBeside(0, 'A');

  // 被系统手势抢走也要收起气泡。
  fireEvent(bar, 'responderTerminate', start);
  expect(bubble()).toBeNull();
});

test('a screen reader double tap on a letter jumps to that section', async () => {
  await renderContacts();

  // VoiceOver 双击。
  fireEvent(screen.getByRole('button', { name: 'C' }), 'accessibilityTap');
  expect(scrollTo).toHaveBeenLastCalledWith({ y: sectionTop(2), animated: false });

  // TalkBack 双击(activate 动作)。
  fireEvent(screen.getByRole('button', { name: 'Z' }), 'accessibilityAction', {
    nativeEvent: { actionName: 'activate' },
  });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: sectionTop(3), animated: false });
  expect(scrollTo).toHaveBeenCalledTimes(2);
});

test('rows grow with the system text size and jumps still land exactly', async () => {
  setFontScale(2);
  await renderContacts();

  expect(heightOf('contacts-row-u-bob')).toBeGreaterThan(68);
  expect(heightOf('contacts-section-A')).toBeGreaterThan(32);

  fireEvent(screen.getByTestId('contacts-index-bar'), 'responderGrant', touchAt(4));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: sectionTop(4), animated: false });
});
