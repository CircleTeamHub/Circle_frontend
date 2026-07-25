import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import SelectCircleScreen from './SelectCircleScreen';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';

const mockRouter = { back: jest.fn() };
// 组件用 fetchMyCircles().finally(...) 标记「拉取完成」，故必须返回 Promise。
const mockFetchMyCircles = jest.fn(() => Promise.resolve());
let mockFocusCallback: (() => void) | null = null;
let mockCommittedAtBack: { id: string; name: string }[] | null = null;

const CIRCLE_A_ID = '07b8cd30-afdf-5b74-9dfe-6dd5b422364b';
const CIRCLE_B_ID = 'cb62ccd9-303f-550c-a5ab-ff9193bdbbd0';
const LEGACY_CIRCLE_A_ID = '07b8cd30-afdf-3b74-5dfe-6dd5b422364b';
// 格式合法的 UUID，但不在 mockCircles 里 —— 模拟「圈子被删除/退出」（区别于
// LEGACY_CIRCLE_A_ID 的「UUID 格式失效」）。
const MISSING_CIRCLE_ID = '11111111-1111-4111-8111-111111111111';

const mockCircles = [
  { id: CIRCLE_A_ID, name: 'Circle A', description: '', avatarUrl: null },
  { id: CIRCLE_B_ID, name: 'Circle B', description: '', avatarUrl: null },
];

// 可变的 my-circles 快照；测试可切成空列表来模拟「退出最后一个圈子后成功返回空」。
let mockJoinedCircles: typeof mockCircles = [mockCircles[1]];
let mockCreatedCircles: typeof mockCircles = [mockCircles[0]];

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (key === 'plaza.circlePicker.selectedCount') {
        return `selected:${options?.count ?? 0}`;
      }
      return options?.defaultValue ?? key;
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => (
      <Text accessibilityLabel={`icon:${name}`}>{name}</Text>
    ),
  };
});

jest.mock('@/theme', () => ({
  Radius: { sm: 4, full: 999 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { caption: {}, body: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#6200ee',
      white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NavHeader: () => (
      <Pressable accessibilityLabel="back" onPress={mockRouter.back}>
        <Text>Back</Text>
      </Pressable>
    ),
  };
});

jest.mock('@/components/ui/circle-avatar', () => ({ CircleAvatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));

jest.mock('@/features/discover/store/use-circles-store', () => ({
  useCirclesStore: (selector: (state: unknown) => unknown) =>
    selector({
      joinedCircles: mockJoinedCircles,
      createdCircles: mockCreatedCircles,
      myCirclesLoading: false,
      myCirclesError: null,
      fetchMyCircles: mockFetchMyCircles,
    }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchMyCircles.mockImplementation(() => Promise.resolve());
  mockJoinedCircles = [mockCircles[1]];
  mockCreatedCircles = [mockCircles[0]];
  mockFocusCallback = null;
  mockCommittedAtBack = null;
  usePostFormStore.setState({
    selectedCircles: [{ id: CIRCLE_A_ID, name: 'Circle A' }],
  });
  mockRouter.back.mockImplementation(() => {
    mockCommittedAtBack = usePostFormStore.getState().selectedCircles;
  });
});

test('ordinary back abandons staged circle edits', async () => {
  render(<SelectCircleScreen />);
  await act(async () => {}); // flush fetchMyCircles().finally → setMyCirclesFetched

  fireEvent.press(screen.getByText('Circle B'));
  expect(screen.getByText('selected:2')).toBeTruthy();
  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: CIRCLE_A_ID, name: 'Circle A' },
  ]);

  fireEvent.press(screen.getByLabelText('back'));

  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: CIRCLE_A_ID, name: 'Circle A' },
  ]);
});

test('empty draft disables confirmation without changing the committed selection', async () => {
  render(<SelectCircleScreen />);
  await act(async () => {});

  fireEvent.press(screen.getByText('Circle A'));

  expect(screen.getByText('selected:0')).toBeTruthy();
  expect(screen.queryAllByLabelText('icon:checkmark-circle')).toHaveLength(0);
  let confirmButton = screen.getByText('确定').parent;
  while (confirmButton && confirmButton.props.accessibilityState === undefined) {
    confirmButton = confirmButton.parent;
  }
  expect(confirmButton?.props.accessibilityState).toEqual(
    expect.objectContaining({ disabled: true }),
  );

  fireEvent.press(confirmButton!);
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: CIRCLE_A_ID, name: 'Circle A' },
  ]);
});

test('refocus resets an abandoned draft and confirm commits only the fresh draft', async () => {
  render(<SelectCircleScreen />);
  await act(async () => {});

  expect(screen.getAllByLabelText('icon:checkmark-circle')).toHaveLength(1);
  fireEvent.press(screen.getByText('Circle B'));
  expect(screen.getByText('selected:2')).toBeTruthy();
  expect(screen.getAllByLabelText('icon:checkmark-circle')).toHaveLength(2);

  act(() => {
    mockFocusCallback?.();
  });
  expect(screen.getByText('selected:1')).toBeTruthy();

  fireEvent.press(screen.getByText('Circle B'));
  fireEvent.press(screen.getByText('确定'));

  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: CIRCLE_A_ID, name: 'Circle A' },
    { id: CIRCLE_B_ID, name: 'Circle B' },
  ]);
  expect(mockCommittedAtBack).toEqual([
    { id: CIRCLE_A_ID, name: 'Circle A' },
    { id: CIRCLE_B_ID, name: 'Circle B' },
  ]);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

test('stale uuid-shaped circle ids are dropped from the draft on focus', async () => {
  usePostFormStore.setState({
    selectedCircles: [{ id: LEGACY_CIRCLE_A_ID, name: 'Old Circle A' }],
  });

  render(<SelectCircleScreen />);
  await act(async () => {});

  expect(screen.getByText('selected:0')).toBeTruthy();
  expect(screen.queryAllByLabelText('icon:checkmark-circle')).toHaveLength(0);
});

test('committed selection drops well-formed but unavailable circles after a successful fetch (plain back keeps the reconciled set)', async () => {
  usePostFormStore.setState({
    selectedCircles: [
      { id: CIRCLE_A_ID, name: 'Circle A' },
      { id: MISSING_CIRCLE_ID, name: 'Deleted Circle' },
    ],
  });

  render(<SelectCircleScreen />);

  // 拉取成功后，已删除/退出的圈子（格式合法但不在 myCircles）从 committed 剔除，
  // 不依赖用户按「确定」。
  await waitFor(() => {
    expect(usePostFormStore.getState().selectedCircles).toEqual([
      { id: CIRCLE_A_ID, name: 'Circle A' },
    ]);
  });

  // 直接返回（未按确定），committed 仍是调和后的集合。
  fireEvent.press(screen.getByLabelText('back'));
  expect(mockCommittedAtBack).toEqual([{ id: CIRCLE_A_ID, name: 'Circle A' }]);
});

test('committed selection is cleared when the only selected circle is unavailable', async () => {
  usePostFormStore.setState({
    selectedCircles: [{ id: MISSING_CIRCLE_ID, name: 'Deleted Circle' }],
  });

  render(<SelectCircleScreen />);

  // 唯一选择失效 → 调和为空。回到发帖页时 selectedCircles 为空，不会提交失效 ID。
  await waitFor(() => {
    expect(usePostFormStore.getState().selectedCircles).toEqual([]);
  });

  fireEvent.press(screen.getByLabelText('back'));
  expect(mockCommittedAtBack).toEqual([]);
});

test('committed selection is cleared after a successful empty circle fetch (loading → empty → back)', async () => {
  // 用户退出了最后一个圈子：fetchMyCircles 成功返回空 joined/created。
  mockJoinedCircles = [];
  mockCreatedCircles = [];
  usePostFormStore.setState({
    selectedCircles: [{ id: MISSING_CIRCLE_ID, name: 'Deleted Circle' }],
  });

  render(<SelectCircleScreen />);

  // Codex P2：权威结果为空也要清掉失效旧选择 —— 不再被「列表非空」守卫挡住。
  await waitFor(() => {
    expect(usePostFormStore.getState().selectedCircles).toEqual([]);
  });

  fireEvent.press(screen.getByLabelText('back'));
  expect(mockCommittedAtBack).toEqual([]);
});
