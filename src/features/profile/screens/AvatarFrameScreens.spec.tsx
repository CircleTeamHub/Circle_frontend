import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import AvatarFrameDetailScreen from './AvatarFrameDetailScreen';
import AvatarFramesScreen from './AvatarFramesScreen';
import {
  equipAvatarFrame,
  fetchAvatarFrameInventory,
} from '@/services/api/avatar-frames';
import { reconcileUserAppearance } from '@/stores/userAppearanceStore';
import type { AuthUser } from '@/stores/authStore';
import type {
  AvatarFrameInventory,
  AvatarFrameInventoryItem,
  UserAppearance,
} from '@/types';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockAuth = { state: {} as Record<string, unknown> };
const mockKnownAccountUpsert = jest.fn();
const mockAppearance = {
  state: {
    appearances: {} as Record<string, UserAppearance>,
    levels: {} as Record<string, number>,
    refreshTick: 0,
  },
};
let mockRouteId: string | undefined = 'frame-a';
let mockLanguage = 'en';
let mockTranslate = makeTranslator(mockLanguage);

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockRouteId }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
    i18n: { language: mockLanguage },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('expo-image', () => ({ Image: () => null }));

jest.mock('@/theme', () => ({
  Radius: { md: 8, lg: 12, xl: 16, full: 999 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  Typography: {
    tiny: {},
    small: {},
    body: {},
    bodyRegular: {},
    h2: {},
    h3: {},
  },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#6200ee',
      primaryLight: '#eee8ff',
      white: '#fff',
      error: '#c00',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});

jest.mock('@/components/ui/avatar', () => ({
  Avatar: () => null,
}));

jest.mock('@/features/profile/membership-frames', () => ({
  getAvatarFrameSource: () => null,
}));

jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

jest.mock('@/services/api/avatar-frames', () => ({
  fetchAvatarFrameInventory: jest.fn(),
  equipAvatarFrame: jest.fn(),
}));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAuth.state),
    { getState: () => mockAuth.state },
  ),
}));

jest.mock('@/stores/knownAccountsStore', () => ({
  useKnownAccountsStore: {
    getState: () => ({ upsertAccount: mockKnownAccountUpsert }),
  },
}));

jest.mock('@/stores/userAppearanceStore', () => ({
  reconcileUserAppearance: jest.fn(
    (userId: string, appearance: UserAppearance) => {
      mockAppearance.state = {
        ...mockAppearance.state,
        appearances: {
          ...mockAppearance.state.appearances,
          [userId]: appearance,
        },
        levels: {
          ...mockAppearance.state.levels,
          [userId]: appearance.vipLevel,
        },
      };
    },
  ),
  useUserAppearanceStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAppearance.state),
    {
      getState: () => mockAppearance.state,
      setState: (
        update:
          | Partial<typeof mockAppearance.state>
          | ((
              state: typeof mockAppearance.state,
            ) => Partial<typeof mockAppearance.state>),
      ) => {
        const partial =
          typeof update === 'function'
            ? update(mockAppearance.state)
            : update;
        mockAppearance.state = { ...mockAppearance.state, ...partial };
      },
    },
  ),
}));

const mockFetchInventory = fetchAvatarFrameInventory as jest.MockedFunction<
  typeof fetchAvatarFrameInventory
>;
const mockEquipFrame = equipAvatarFrame as jest.MockedFunction<
  typeof equipAvatarFrame
>;
const mockReconcileUserAppearance =
  reconcileUserAppearance as jest.MockedFunction<
    typeof reconcileUserAppearance
  >;

function makeTranslator(language: string) {
  return (
    key: string,
    options?: Record<string, string | number | undefined>,
  ) => {
    const suffix =
      options && Object.keys(options).length > 0
        ? `:${Object.values(options).join(',')}`
        : '';
    return `${language}:${key}${suffix}`;
  };
}

function makeUser(
  overrides: Partial<AuthUser> = {},
): AuthUser {
  return {
    id: 'user-a',
    accountId: 'user-a',
    uid: 'user-a',
    nickname: 'User A',
    avatarUrl: null,
    avatarFrame: null,
    avatarFrameAppearance: null,
    cover: null,
    email: null,
    phoneNumber: null,
    wechat: null,
    qq: null,
    whatsup: null,
    persona: null,
    helloWords: null,
    birthday: null,
    gender: 'unset',
    role: 'USER',
    status: 'ACTIVE',
    lastOnline: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    city: null,
    vipLevel: 2,
    creditScore: 100,
    fancyNumber: false,
    displayIcons: [],
    ...overrides,
  };
}

function makeItem(
  id: string,
  overrides: Partial<AvatarFrameInventoryItem> = {},
): AvatarFrameInventoryItem {
  return {
    id,
    key: `${id}-key`,
    name: `${id}-name`,
    imageUrl: `https://example.com/${id}.png`,
    description: `${id}-description`,
    minimumVipLevel: null,
    ownedSources: [
      { type: 'ADMIN', grantId: `${id}-grant`, expiresAt: null },
    ],
    availableUntil: null,
    equipped: false,
    ...overrides,
  };
}

function makeInventory(
  equippedFrameId: string | null = null,
  items = [makeItem('frame-a'), makeItem('frame-b')],
): AvatarFrameInventory {
  return {
    equippedFrameId,
    items: items.map((item) => ({
      ...item,
      equipped: item.id === equippedFrameId,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setAuth(user: AuthUser, sessionEpoch = 1) {
  const setUser = jest.fn((nextUser: AuthUser) => {
    mockAuth.state = { ...mockAuth.state, user: nextUser };
  });
  mockAuth.state = {
    user,
    setUser,
    sessionEpoch,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    imToken: 'im-token',
  };
  return setUser;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteId = 'frame-a';
  mockLanguage = 'en';
  mockTranslate = makeTranslator(mockLanguage);
  setAuth(makeUser());
  mockAppearance.state = {
    appearances: {},
    levels: {},
    refreshTick: 0,
  };
});

test('collection shows loading and then renders the fetched inventory', async () => {
  const request = deferred<AvatarFrameInventory>();
  mockFetchInventory.mockReturnValueOnce(request.promise);

  render(<AvatarFramesScreen />);

  expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  expect(screen.queryByText('frame-a-name')).toBeNull();

  await act(async () => {
    request.resolve(makeInventory('frame-a'));
    await request.promise;
  });

  expect(screen.getAllByText('frame-a-name')).toHaveLength(2);
  expect(screen.getByText('frame-b-name')).toBeTruthy();
});

test('collection retries an initial load error and renders the recovered inventory', async () => {
  mockFetchInventory
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(makeInventory());

  render(<AvatarFramesScreen />);

  expect(
    await screen.findByText('en:profile.avatarFrames.loadError'),
  ).toBeTruthy();
  fireEvent.press(screen.getByText('en:profile.avatarFrames.retry'));

  expect(await screen.findByText('frame-a-name')).toBeTruthy();
  expect(mockFetchInventory).toHaveBeenCalledTimes(2);
});

test.each([undefined, 'not-owned'])(
  'detail route id %s never offers or sends an equip request',
  async (routeId) => {
    mockRouteId = routeId;
    mockFetchInventory.mockResolvedValueOnce(makeInventory());

    render(<AvatarFrameDetailScreen />);

    expect(
      await screen.findByText('en:profile.avatarFrames.notFound'),
    ).toBeTruthy();
    expect(
      screen.queryByLabelText('en:profile.avatarFrames.equip'),
    ).toBeNull();
    expect(mockEquipFrame).not.toHaveBeenCalled();
  },
);

test('detail suppresses duplicate equip taps while the first request is pending', async () => {
  const save = deferred<AvatarFrameInventory>();
  mockFetchInventory.mockResolvedValueOnce(makeInventory());
  mockEquipFrame.mockReturnValueOnce(save.promise);

  render(<AvatarFrameDetailScreen />);

  const button = await screen.findByLabelText(
    'en:profile.avatarFrames.equip',
  );
  let pressable: typeof button | null = button;
  while (pressable && typeof pressable.props.onPress !== 'function') {
    pressable = pressable.parent;
  }
  expect(pressable).not.toBeNull();
  act(() => {
    pressable?.props.onPress();
    pressable?.props.onPress();
  });

  expect(mockEquipFrame).toHaveBeenCalledTimes(1);
  expect(mockEquipFrame).toHaveBeenCalledWith('frame-a');

  await act(async () => {
    save.resolve(makeInventory('frame-a'));
    await save.promise;
  });
});

test('failed equip preserves auth, appearance cache, and equipped UI state', async () => {
  const priorFrame = makeItem('frame-b');
  const priorAppearance = {
    id: priorFrame.id,
    key: priorFrame.key,
    name: priorFrame.name,
    imageUrl: priorFrame.imageUrl,
  };
  const priorUser = makeUser({
    avatarFrame: priorFrame.imageUrl,
    avatarFrameAppearance: priorAppearance,
  });
  const setUser = setAuth(priorUser);
  mockAppearance.state = {
    appearances: {
      [priorUser.id]: {
        vipLevel: priorUser.vipLevel,
        avatarFrame: priorAppearance,
      },
    },
    levels: { [priorUser.id]: priorUser.vipLevel },
    refreshTick: 7,
  };
  const priorCache = structuredClone(mockAppearance.state);
  mockRouteId = 'frame-b';
  mockFetchInventory.mockResolvedValueOnce(makeInventory('frame-b'));
  mockEquipFrame.mockRejectedValueOnce(new Error('save failed'));

  render(<AvatarFrameDetailScreen />);

  expect(
    await screen.findByText('en:profile.avatarFrames.equipped'),
  ).toBeTruthy();
  fireEvent.press(
    screen.getByLabelText('en:profile.avatarFrames.remove'),
  );

  expect(
    await screen.findByText('en:profile.avatarFrames.saveError'),
  ).toBeTruthy();
  expect(screen.getByText('en:profile.avatarFrames.equipped')).toBeTruthy();
  expect(mockEquipFrame).toHaveBeenCalledWith(null);
  expect(setUser).not.toHaveBeenCalled();
  expect(mockAuth.state.user).toBe(priorUser);
  expect(mockAppearance.state).toEqual(priorCache);
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('successful equip updates auth and the user appearance cache', async () => {
  const priorUser = makeUser();
  const setUser = setAuth(priorUser);
  mockAppearance.state = {
    appearances: {
      [priorUser.id]: { vipLevel: 1, avatarFrame: null },
      untouched: { vipLevel: 4, avatarFrame: null },
    },
    levels: { [priorUser.id]: 1, untouched: 4 },
    refreshTick: 3,
  };
  const equippedInventory = makeInventory('frame-a');
  const equippedItem = equippedInventory.items[0];
  mockFetchInventory.mockResolvedValueOnce(makeInventory());
  mockEquipFrame.mockResolvedValueOnce(equippedInventory);

  render(<AvatarFrameDetailScreen />);

  fireEvent.press(
    await screen.findByLabelText('en:profile.avatarFrames.equip'),
  );

  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  const expectedAppearance = {
    id: equippedItem.id,
    key: equippedItem.key,
    name: equippedItem.name,
    imageUrl: equippedItem.imageUrl,
  };
  expect(setUser).toHaveBeenCalledWith({
    ...priorUser,
    avatarFrame: equippedItem.imageUrl,
    avatarFrameAppearance: expectedAppearance,
  });
  expect(mockReconcileUserAppearance).toHaveBeenCalledWith(priorUser.id, {
    vipLevel: priorUser.vipLevel,
    avatarFrame: expectedAppearance,
  });
  expect(mockAppearance.state).toEqual({
    appearances: {
      [priorUser.id]: {
        vipLevel: priorUser.vipLevel,
        avatarFrame: expectedAppearance,
      },
      untouched: { vipLevel: 4, avatarFrame: null },
    },
    levels: { [priorUser.id]: priorUser.vipLevel, untouched: 4 },
    refreshTick: 3,
  });
  expect(mockKnownAccountUpsert).toHaveBeenCalledWith({
    user: {
      ...priorUser,
      avatarFrame: equippedItem.imageUrl,
      avatarFrameAppearance: expectedAppearance,
    },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    imToken: 'im-token',
    updatedAt: expect.any(Number),
  });
});

test('equip completion from an older login cannot mutate the same user after relogin', async () => {
  const save = deferred<AvatarFrameInventory>();
  const originalUser = makeUser();
  const originalSetUser = setAuth(originalUser, 1);
  mockFetchInventory.mockResolvedValueOnce(makeInventory());
  mockEquipFrame.mockReturnValueOnce(save.promise);

  render(<AvatarFrameDetailScreen />);
  fireEvent.press(
    await screen.findByLabelText('en:profile.avatarFrames.equip'),
  );

  const reloggedUser = makeUser({ nickname: 'Relogged User' });
  const reloggedSetUser = setAuth(reloggedUser, 2);
  await act(async () => {
    save.resolve(makeInventory('frame-a'));
    await save.promise;
  });

  expect(originalSetUser).not.toHaveBeenCalled();
  expect(reloggedSetUser).not.toHaveBeenCalled();
  expect(mockReconcileUserAppearance).not.toHaveBeenCalled();
  expect(mockKnownAccountUpsert).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

test('locale rerender ignores the old detail load and applies the replacement result', async () => {
  const oldRequest = deferred<AvatarFrameInventory>();
  const newRequest = deferred<AvatarFrameInventory>();
  mockFetchInventory
    .mockReturnValueOnce(oldRequest.promise)
    .mockReturnValueOnce(newRequest.promise);
  const view = render(<AvatarFrameDetailScreen />);
  await waitFor(() => expect(mockFetchInventory).toHaveBeenCalledTimes(1));

  mockLanguage = 'es';
  mockTranslate = makeTranslator(mockLanguage);
  view.rerender(<AvatarFrameDetailScreen />);
  await waitFor(() => expect(mockFetchInventory).toHaveBeenCalledTimes(2));

  await act(async () => {
    oldRequest.resolve(
      makeInventory(null, [makeItem('frame-a', { name: 'stale-name' })]),
    );
    await oldRequest.promise;
  });
  expect(screen.queryByText('stale-name')).toBeNull();

  await act(async () => {
    newRequest.resolve(
      makeInventory(null, [makeItem('frame-a', { name: 'fresh-name' })]),
    );
    await newRequest.promise;
  });

  expect(await screen.findByText('fresh-name')).toBeTruthy();
  expect(screen.queryByText('stale-name')).toBeNull();
});
