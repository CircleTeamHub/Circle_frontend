import React from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CircleDetailScreen from './CircleDetailScreen';
import { fetchCircleDetail, fetchMyApplications, leaveCircle } from '@/services/api/circles';
const mockChangeAvatar = jest.fn();

// 圈子详情:看过的圈子再进先用内存缓存画出来,后台照常重拉;没缓存过才整页转圈。
let mockEpoch = 0;
let mockCircleId = 'circle-1';
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: { sessionEpoch: number }) => unknown) =>
    select({ sessionEpoch: mockEpoch }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockCircleId }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)', 'discover'],
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(callback, [callback]);
  },
}));
let mockLastCircleWriteAt = 0;
jest.mock('@/services/api/circles', () => ({
  fetchCircleDetail: jest.fn(),
  fetchMyApplications: jest.fn(),
  leaveCircle: jest.fn(),
  joinCircle: jest.fn(),
  uploadCircleIcon: jest.fn(),
  setCircleAvatar: jest.fn(),
  circlesMutatedSince: (since: number) => mockLastCircleWriteAt >= since,
}));
jest.mock('@/services/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super(String(status));
      this.status = status;
    }
  }
  return { ApiError };
});
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/services/api/upload', () => ({}));
jest.mock('@/chat-core/client', () => ({ ensureCircleConversation: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/discover/store/use-circles-store', () => ({
  useCirclesStore: { getState: () => ({ patchCircle: jest.fn(), removeCircle: jest.fn(), fetchMyCircles: jest.fn() }) },
}));
jest.mock('@/features/discover/hooks/use-change-circle-cover', () => ({
  useChangeCircleCover: () => ({ changeCover: jest.fn() }),
}));
jest.mock('@/hooks/use-change-avatar', () => ({
  useChangeAvatar: () => ({ changeAvatar: mockChangeAvatar, changing: false }),
}));
jest.mock('@/components/ui/avatar-photo-viewer', () => {
  const { View } = jest.requireActual('react-native');
  return { AvatarPhotoViewer: (props: Record<string, unknown>) => <View testID="avatar-preview" {...props} /> };
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), MediaTypeOptions: {} }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/storage', () => ({ storage: { getString: jest.fn(), set: jest.fn() } }));
// t 要稳定:真实的 i18next 只在换语言时才换 t,每次渲染都新造会让聚焦回调反复重跑。
const mockT = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@/components/ui/nav-header', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});
jest.mock('@/components/ui/gradient-cover', () => ({ GradientCover: () => null }));
jest.mock('@/components/ui/circle-avatar', () => ({ CircleAvatar: () => null }));

const circle = (overrides: Record<string, unknown> = {}) => ({
  id: mockCircleId,
  name: '徒步圈',
  avatarUrl: null,
  cover: null,
  currentIconUrl: null,
  description: '',
  rules: '',
  categories: [],
  tags: [],
  cities: [],
  memberCount: 12,
  postCount: 3,
  joinVipRestriction: null,
  joinCreditRestriction: null,
  joinFancyRestriction: false,
  memberCanPost: true,
  groupID: null,
  myRole: 'MEMBER',
  myStatus: 'ACTIVE',
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const spinnerCount = () => screen.UNSAFE_queryAllByType(ActivityIndicator).length;

async function visitOnce(loaded = circle()) {
  jest.mocked(fetchCircleDetail).mockResolvedValueOnce(loaded as never);
  const view = render(<CircleDetailScreen />);
  expect(await screen.findByText(loaded.name as string)).toBeTruthy();
  view.unmount();
}

test.each(['OWNER', 'ADMIN', 'MEMBER'])('circle avatar previews before picking and only OWNER can edit: %s', async (role) => {
  jest.mocked(fetchCircleDetail).mockResolvedValueOnce(circle({ myRole: role, avatarUrl: 'https://example.test/circle.jpg' }) as never);
  render(<CircleDetailScreen />);
  await screen.findByText('徒步圈');
  fireEvent.press(screen.getByLabelText('avatarPhoto.view'));
  expect(mockChangeAvatar).not.toHaveBeenCalled();
  const preview = screen.getByTestId('avatar-preview');
  expect(preview.props.uri).toBe('https://example.test/circle.jpg');
  if (role === 'OWNER') {
    fireEvent(preview, 'change', 'library');
    expect(mockChangeAvatar).toHaveBeenCalledWith('library');
  } else {
    expect(preview.props.onChange).toBeUndefined();
  }
});

const neverSettles = () => new Promise<never>(() => {});

beforeEach(() => {
  jest.resetAllMocks();
  // 每个用例换一个账号:缓存按 epoch 整份清空,用例之间互不串。
  mockEpoch += 1;
  mockLastCircleWriteAt = 0;
  mockCircleId = 'circle-1';
  // 没特别安排的请求一直挂着,不让 undefined 当成数据落进页面。
  jest.mocked(fetchCircleDetail).mockReturnValue(neverSettles());
  jest.mocked(fetchMyApplications).mockResolvedValue([]);
});

test('the first visit spins, a revisit paints the cached circle at once and refreshes behind it', async () => {
  jest.mocked(fetchCircleDetail).mockResolvedValueOnce(circle() as never);
  const first = render(<CircleDetailScreen />);
  expect(spinnerCount()).toBe(1);
  expect(await screen.findByText('徒步圈')).toBeTruthy();
  first.unmount();

  const refresh = deferred<unknown>();
  jest.mocked(fetchCircleDetail).mockReturnValueOnce(refresh.promise as never);
  render(<CircleDetailScreen />);
  expect(screen.getByText('徒步圈')).toBeTruthy();
  expect(spinnerCount()).toBe(0);
  expect(fetchCircleDetail).toHaveBeenCalledTimes(2);

  await act(async () => refresh.resolve(circle({ memberCount: 13 })));
  expect(screen.getByText('13')).toBeTruthy();
});

test('the background refresh recalibrates membership drawn from the cache', async () => {
  await visitOnce(circle({ myRole: null, myStatus: null }));

  const refresh = deferred<unknown>();
  jest.mocked(fetchCircleDetail).mockReturnValueOnce(refresh.promise as never);
  render(<CircleDetailScreen />);
  expect(screen.getByText('加入圈子')).toBeTruthy();

  await act(async () => refresh.resolve(circle()));
  expect(screen.queryByText('加入圈子')).toBeNull();
  expect(screen.getByText('退出圈子')).toBeTruthy();
});

test('a failed background refresh keeps the cached circle with an inline error', async () => {
  await visitOnce();

  jest.mocked(fetchCircleDetail).mockRejectedValueOnce(new Error('offline'));
  render(<CircleDetailScreen />);
  expect(await screen.findByText('circle.loadError')).toBeTruthy();
  expect(screen.getByText('徒步圈')).toBeTruthy();
  expect(spinnerCount()).toBe(0);
});

test('a 404 drops the cached circle so the next visit does not show it again', async () => {
  await visitOnce();

  const { ApiError } = jest.requireMock('@/services/api/client') as {
    ApiError: new (status: number) => Error;
  };
  jest.mocked(fetchCircleDetail).mockRejectedValueOnce(new ApiError(404));
  const second = render(<CircleDetailScreen />);
  expect(await screen.findByText('circle.notExist')).toBeTruthy();
  second.unmount();

  render(<CircleDetailScreen />);
  expect(spinnerCount()).toBe(1);
});

test('a pending application is remembered with the circle', async () => {
  const pending = circle({ myRole: null, myStatus: 'PENDING' });
  const application = {
    id: 'inv-1',
    circleId: mockCircleId,
    status: 'PENDING',
    approvedCount: 3,
    requiredCount: 10,
  };
  jest.mocked(fetchMyApplications).mockResolvedValueOnce([application] as never);
  jest.mocked(fetchCircleDetail).mockResolvedValueOnce(pending as never);
  const first = render(<CircleDetailScreen />);
  expect(await screen.findByText('邀请好友为我验证 ({{approved}}/{{required}})')).toBeTruthy();
  first.unmount();

  // 再进时「我的申请」还在路上:按钮照旧是验证入口,不先闪成「审核中」。
  jest.mocked(fetchMyApplications).mockReturnValueOnce(neverSettles());
  render(<CircleDetailScreen />);
  expect(screen.getByText('邀请好友为我验证 ({{approved}}/{{required}})')).toBeTruthy();
  expect(screen.queryByText('审核中')).toBeNull();
});

test('leaving the circle forgets it, so the next visit loads fresh', async () => {
  await visitOnce();

  jest.mocked(leaveCircle).mockResolvedValueOnce(undefined);
  // 二次确认框直接点「退出」。
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    void buttons?.[1]?.onPress?.();
  });
  const second = render(<CircleDetailScreen />);
  await act(async () => {
    fireEvent.press(screen.getByText('退出圈子'));
  });
  expect(leaveCircle).toHaveBeenCalledWith(mockCircleId);
  second.unmount();
  alert.mockRestore();

  render(<CircleDetailScreen />);
  expect(spinnerCount()).toBe(1);
});

// 在群聊信息页退圈/解散、在编辑页改资料……这些写操作不经过本页。拉到缓存之后只要有过
// 群/圈子写操作,下次进来就不能先按旧的成员关系画按钮。
test('a circle write elsewhere after the visit makes the next visit load fresh', async () => {
  await visitOnce();
  mockLastCircleWriteAt = Date.now() + 1;
  render(<CircleDetailScreen />);
  expect(screen.queryByText('徒步圈')).toBeNull();
  expect(spinnerCount()).toBe(1);
});
