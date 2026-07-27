import React from 'react';
import { render, screen } from '@testing-library/react-native';
import CreateCircleScreen from './CreateCircleScreen';

const mockRouter = { back: jest.fn() };
const mockFetchProgramStatus = jest.fn();
const mockFetchMyCircles = jest.fn();
const mockResetForm = jest.fn();
const mockAuth = { user: { vipLevel: 0 } };
const mockProgram = {
  status: null as {
    enabled: boolean;
    enabledAt: string | null;
    entitlementFloorLevel: 0 | 2;
  } | null,
};

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void) => {
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

jest.mock('@expo/vector-icons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('@/theme', () => ({
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { caption: {}, body: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surfaceBorder: '#ddd',
      textSecondary: '#666',
      primary: '#6200ee',
      warning: '#f90',
      white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => ({
  NavHeader: () => null,
}));

jest.mock('@/components/ui/keyboard-dismiss', () => ({
  keyboardDismissOnDragProps: {},
}));

jest.mock('@/features/discover/components/circle-form-body', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    CircleFormBody: () => <Text>circle-form</Text>,
  };
});

jest.mock('@/features/discover/hooks/use-circle-form', () => ({
  useCircleForm: () => ({
    name: '',
    description: '',
    pickedAvatarUri: null,
    selectedCategories: [],
    rules: '',
    joinVipRestriction: null,
    joinCreditRestriction: null,
    joinFancyRestriction: false,
    memberCanPost: false,
  }),
}));

jest.mock('@/features/discover/store/use-create-circle-form-store', () => ({
  useCreateCircleFormStore: (selector: (state: unknown) => unknown) =>
    selector({ selectedCities: [], reset: mockResetForm }),
}));

jest.mock('@/features/discover/store/use-circles-store', () => ({
  useCirclesStore: (selector: (state: unknown) => unknown) =>
    selector({ fetchMyCircles: mockFetchMyCircles }),
}));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: mockAuth.user }),
}));

jest.mock('@/stores/membershipProgramStore', () => ({
  useMembershipProgramStore: (selector: (state: unknown) => unknown) =>
    selector({
      status: mockProgram.status,
      fetchStatus: mockFetchProgramStatus,
    }),
}));

jest.mock('@/services/api/circles', () => ({
  createCircle: jest.fn(),
}));

jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  resolveUploadContentType: jest.fn(),
  sanitizeUploadFilename: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { vipLevel: 0 };
  mockProgram.status = null;
  mockFetchProgramStatus.mockResolvedValue(null);
});

test('unknown program status defers the creation decision to the backend', () => {
  render(<CreateCircleScreen />);

  expect(screen.getByText('circle-form')).toBeTruthy();
  expect(screen.queryByText('circle.create.vipRequired')).toBeNull();
});

test('Gold rollout floor admits a regular user to the creation form', () => {
  mockProgram.status = {
    enabled: false,
    enabledAt: null,
    entitlementFloorLevel: 2,
  };

  render(<CreateCircleScreen />);

  expect(screen.getByText('circle-form')).toBeTruthy();
  expect(screen.queryByText('circle.create.vipRequired')).toBeNull();
});

test('known zero floor keeps the VIP creation gate for a regular user', () => {
  mockProgram.status = {
    enabled: true,
    enabledAt: '2026-08-01T00:00:00.000Z',
    entitlementFloorLevel: 0,
  };

  render(<CreateCircleScreen />);

  expect(screen.getByText('circle.create.vipRequired')).toBeTruthy();
  expect(screen.queryByText('circle-form')).toBeNull();
});
