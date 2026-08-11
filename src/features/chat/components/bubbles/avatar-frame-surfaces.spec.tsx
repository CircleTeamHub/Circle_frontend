import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ReceivedBubble } from './received-bubble';
import { SentBubble } from './sent-bubble';
import { NoteCardBubble } from './note-card-bubble';
import { FriendCardBubble } from './friend-card-bubble';
import { CircleCardBubble } from './circle-card-bubble';
import { TransferCardBubble } from './transfer-card-bubble';
import { ImageBubble } from './image-bubble';
import { VoiceBubble } from './voice-bubble';
import ProfileScreen from '@/features/profile/screens/ProfileScreen';
import {
  invalidateUserAppearances,
  reconcileUserAppearance,
} from '@/stores/userAppearanceStore';
import type { AuthUser } from '@/stores/authStore';
import type { AvatarFrameAppearance, ChatMessage } from '@/types';

// bubble → @/i18n → @/storage → MMKV/AsyncStorage 的原生模块在 jest 里都是
// null,整个 suite 会在加载阶段就挂(这条 spec 之前一直跑不起来)。
// 本 suite 只关心头像框,持久化整层顶掉即可 —— 与 moment-comment-input.spec 同款。
jest.mock('@/storage', () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {} },
  mmkvJsonStorage: {},
}));
// i18n 运行时本身也不该在这条 spec 里启动:react-i18next 已被下面顶掉,
// 真 init 会拿到 undefined 的 initReactI18next 直接抛。
// expo-audio 在 jest 里没有原生模块;语音气泡只是要它渲染出头像。
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    seekTo: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }),
  setAudioModeAsync: jest.fn(),
}));
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
    language: 'zh',
  },
}));

const mockRouter = { push: jest.fn() };
const mockAvatar = jest.fn((_props: Record<string, unknown>) => null);
const mockGetAvatarFrameSource = jest.fn(
  (frame: AvatarFrameAppearance | null | undefined) =>
    frame?.imageUrl ? { uri: frame.imageUrl } : null,
);
let mockAuthState: {
  user: AuthUser | null;
  setUser: jest.Mock;
} = {
  user: null,
  setUser: jest.fn(),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: () => undefined,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: Object.assign(() => null, { glyphMap: {} }),
}));

jest.mock('@/theme', () => ({
  Gradients: { memberCard: ['#111', '#222'] },
  Radius: { md: 12, lg: 16 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  Typography: {
    tiny: {},
    tinyRegular: {},
    small: {},
    bodyRegular: {},
    caption: {},
    h2: {},
  },
  useTheme: () => ({
    colors: {
      background: '#fff',
      error: '#c00',
      memberTagBg: '#444',
      primary: '#6200ee',
      receivedBubble: '#eee',
      sentBubble: '#6200ee',
      surface: '#fff',
      text: '#111',
      textSecondary: '#666',
      white: '#fff',
    },
    resolvedMode: 'light',
    toggleTheme: jest.fn(),
  }),
}));

jest.mock('@/components/ui/avatar', () => ({
  Avatar: (props: Record<string, unknown>) => mockAvatar(props),
}));

jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/gradient-cover', () => ({
  GradientCover: () => null,
}));
jest.mock('@/components/ui/member-name', () => ({ MemberName: () => null }));
jest.mock('@/components/ui/menu-row', () => ({ MenuRow: () => null }));
jest.mock('@/components/ui/user-icon-row', () => ({
  UserIconRow: () => null,
}));

jest.mock('@/features/profile/membership-frames', () => ({
  getAvatarFrameSource: (frame: AvatarFrameAppearance | null | undefined) =>
    mockGetAvatarFrameSource(frame),
}));

jest.mock('@/features/profile/member-stat-colors', () => ({
  getCreditStatBackground: () => '#fff',
  getCreditStatTextColor: () => '#111',
  getVipStatBackground: () => '#111',
  getVipStatTextColor: () => '#fff',
}));

jest.mock('@/features/profile/membership-plans', () => ({
  getMembershipTierForVipLevel: () => null,
}));

jest.mock('@/features/user/utils/routes', () => ({
  getUserProfileHref: () => '/profile/user',
}));

jest.mock('@/services/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
}));

jest.mock('@/services/api/icons', () => ({
  fetchIconOptions: jest.fn(),
}));

jest.mock('@/services/api/avatar-frames', () => ({
  AvatarFrameResponseValidationError: class extends Error {},
  fetchUserAppearances: jest.fn(),
}));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));

jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: (
    selector: (state: { profileUnread: number }) => unknown,
  ) => selector({ profileUnread: 0 }),
}));

const receivedMessage: ChatMessage = {
  id: 'received-1',
  type: 'received',
  text: 'hello',
  senderID: 'alice',
};

const sentMessage: ChatMessage = {
  id: 'sent-1',
  type: 'sent',
  text: 'hello',
};

const customFrame: AvatarFrameAppearance = {
  id: 'event-frame',
  key: 'event-2026',
  name: 'Event frame',
  imageUrl: 'https://cdn.example.com/event.png',
};

function makeUser(
  avatarFrameAppearance: AvatarFrameAppearance | null,
): AuthUser {
  return {
    id: 'self',
    accountId: 'self',
    uid: 'self',
    nickname: 'Self',
    avatarUrl: null,
    avatarFrame: avatarFrameAppearance?.imageUrl ?? null,
    avatarFrameAppearance,
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
    vipLevel: 4,
    creditScore: 100,
    fancyNumber: false,
    displayIcons: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidateUserAppearances();
  mockAuthState = { user: makeUser(null), setUser: jest.fn() };
});

afterEach(() => {
  invalidateUserAppearances();
});

test('received bubble rerenders when the async appearance hook gains and removes a frame', () => {
  render(
    <ReceivedBubble
      message={receivedMessage}
      senderName="Alice"
    />,
  );

  expect(mockAvatar).toHaveBeenLastCalledWith(
    expect.objectContaining({ frameSource: undefined }),
  );

  act(() => {
    reconcileUserAppearance('alice', {
      vipLevel: 2,
      avatarFrame: customFrame,
    });
  });

  expect(mockAvatar).toHaveBeenLastCalledWith(
    expect.objectContaining({
      frameSource: { uri: customFrame.imageUrl },
    }),
  );

  act(() => {
    reconcileUserAppearance('alice', {
      vipLevel: 2,
      avatarFrame: null,
    });
  });

  expect(mockAvatar).toHaveBeenLastCalledWith(
    expect.objectContaining({ frameSource: undefined }),
  );
});

test.each([
  ['custom', customFrame, { uri: customFrame.imageUrl }],
  ['null', null, undefined],
] as const)(
  'sent bubble renders the auth-backed %s frame source',
  (_label, avatarFrameAppearance, expectedFrameSource) => {
    mockAuthState = {
      user: makeUser(avatarFrameAppearance),
      setUser: jest.fn(),
    };

    render(<SentBubble message={sentMessage} selfName="Self" />);

    expect(mockAvatar).toHaveBeenLastCalledWith(
      expect.objectContaining({ frameSource: expectedFrameSource }),
    );
  },
);

test.each([
  ['custom', customFrame, { uri: customFrame.imageUrl }],
  ['null', null, undefined],
] as const)(
  'profile header renders the auth-backed %s frame source',
  (_label, avatarFrameAppearance, expectedFrameSource) => {
    mockAuthState = {
      user: makeUser(avatarFrameAppearance),
      setUser: jest.fn(),
    };

    render(<ProfileScreen />);

    expect(mockAvatar).toHaveBeenLastCalledWith(
      expect.objectContaining({
        compactFrame: true,
        frameSource: expectedFrameSource,
        size: 56,
      }),
    );
  },
);

// 头像框是会员付费权益,不能只在文字气泡上生效:同一个人发文字是「圆形+框」、
// 发卡片/图片/语音就变成「方形无框」,看起来像两个人(用户实测提的)。
// 每种气泡都必须走 shared 里的同一个 MessageAvatar。
describe('每种气泡的发送者头像都带头像框', () => {
  const cases: [string, ChatMessage][] = [
    ['note-card', { id: 'n1', type: 'note-card', noteCard: { id: 'note-1', title: 'T' } }],
    ['friend-card', { id: 'f1', type: 'friend-card', friendCard: { userID: 'u2', nickname: 'N' } }],
    ['circle-card', { id: 'c1', type: 'circle-card', circleCard: { circleId: 'c', name: 'C' } }],
    ['transfer-card', { id: 't1', type: 'transfer-card', transferCard: { amount: 1 } }],
    ['image', { id: 'i1', type: 'image', imageUrl: 'https://cdn.example.com/a.jpg' }],
    ['voice', { id: 'v1', type: 'voice', voiceDuration: 3 }],
  ] as unknown as [string, ChatMessage][];

  test.each(cases)('%s 气泡把自己的头像框透给 Avatar', (_label, message) => {
    mockAuthState = { user: makeUser(customFrame), setUser: jest.fn() };
    const Bubble = bubbleFor(message.type);

    render(<Bubble message={message} outgoing selfName="Self" />);

    // 名片卡里还有一颗 48pt 的「被推荐好友」头像,那颗不该套发送者的框 ——
    // 所以用 toHaveBeenCalledWith 匹配任意一次调用,而不是最后一次。
    expect(mockAvatar).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 36,
        compactFrame: true,
        frameSource: { uri: customFrame.imageUrl },
      }),
    );
  });
});

interface BubbleUnderTestProps {
  message: ChatMessage;
  outgoing: boolean;
  selfName?: string;
}

function bubbleFor(type: string): React.ComponentType<BubbleUnderTestProps> {
  const byType: Record<string, React.ComponentType<BubbleUnderTestProps>> = {
    'note-card': NoteCardBubble,
    'friend-card': FriendCardBubble,
    'circle-card': CircleCardBubble,
    'transfer-card': TransferCardBubble,
    image: ImageBubble,
    voice: VoiceBubble,
  };
  return byType[type];
}
