import React from 'react';
import { Text as MockText } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import VerificationRequestScreen from './VerificationRequestScreen';
import { fetchInvitation } from '@/services/api/circles';
import type { CircleInvitation } from '@/types';

let mockViewerId = 'applicant';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'request' }),
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock('react-i18next', () => {
  const i18n = jest.requireActual('i18next').createInstance();
  void i18n.init({
    lng: 'zh', initImmediate: false,
    resources: { zh: { translation: require('@/i18n/locales/zh.json') } },
  });
  const t = i18n.t.bind(i18n);
  return { useTranslation: () => ({ t }) };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/nav-header', () => ({
  NavHeader: ({ title }: { title: string }) => <MockText>{title}</MockText>,
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: mockViewerId } }),
}));
jest.mock('@/services/api/circles', () => ({ fetchInvitation: jest.fn(), respondToVerification: jest.fn() }));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/features/notifications/utils/seen-target', () => ({
  markMatchingTargetNotificationsRead: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/theme', () => ({
  Radius: { full: 999 }, Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { body: {}, caption: {}, h2: {} },
  useTheme: () => ({ colors: { background: '#fff', textSecondary: '#555', primary: '#00f' } }),
}));

const applicant = { id: 'applicant', nickname: '丁哥只认钱', avatarUrl: null, accountId: 'a' };
const request: CircleInvitation = {
  id: 'request', circleId: 'circle', circleName: 'NBA', applicant, inviter: applicant,
  status: 'PENDING', approvedCount: 1, requiredCount: 10, verifiers: [], createdAt: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockViewerId = applicant.id;
  jest.mocked(fetchInvitation).mockResolvedValue(request);
});

it('shows an application progress page without claiming the applicant invited themselves', async () => {
  render(<VerificationRequestScreen />);
  expect(await screen.findByText('申请加入「NBA」')).toBeTruthy();
  expect(screen.getByText('入圈申请进度')).toBeTruthy();
  expect(screen.queryByText(/邀请人：|由.*邀请/)).toBeNull();
  expect(screen.getByText('已获验证：1/10 人')).toBeTruthy();
  expect(screen.getByText('获得 10 位圈内成员验证后即可加入')).toBeTruthy();
});

it('distinguishes a real inviter by id even when both people have the same nickname', async () => {
  jest.mocked(fetchInvitation).mockResolvedValue({
    ...request, inviter: { ...applicant, id: 'inviter' },
  });
  render(<VerificationRequestScreen />);
  expect(await screen.findByText('受邀加入「NBA」')).toBeTruthy();
  expect(screen.getByText('邀请人：丁哥只认钱')).toBeTruthy();
});

it('uses the viewer’s perspective when the actual inviter opens the request', async () => {
  mockViewerId = 'inviter';
  jest.mocked(fetchInvitation).mockResolvedValue({
    ...request, inviter: { ...applicant, id: mockViewerId },
  });
  render(<VerificationRequestScreen />);
  expect(await screen.findByText('由你邀请')).toBeTruthy();
  expect(screen.getByText('入圈验证请求')).toBeTruthy();
  expect(screen.queryByText('入圈申请进度')).toBeNull();
});

it('uses the request’s configured verification threshold', async () => {
  jest.mocked(fetchInvitation).mockResolvedValue({ ...request, approvedCount: 2, requiredCount: 5 });
  render(<VerificationRequestScreen />);
  expect(await screen.findByText('已获验证：2/5 人')).toBeTruthy();
  expect(screen.getByText('获得 5 位圈内成员验证后即可加入')).toBeTruthy();
});

it('keeps verification actions clear when another member views a self-initiated application', async () => {
  mockViewerId = 'verifier';
  jest.mocked(fetchInvitation).mockResolvedValue({
    ...request, verifiers: [{
      id: 'seat', status: 'PENDING', respondedAt: null,
      verifier: { ...applicant, id: mockViewerId, nickname: '圈内成员' },
    }],
  });
  render(<VerificationRequestScreen />);
  expect(await screen.findByText('申请加入「NBA」')).toBeTruthy();
  expect(screen.getByText('入圈验证请求')).toBeTruthy();
  expect(screen.getByText('同意')).toBeTruthy();
  expect(screen.getByText('拒绝')).toBeTruthy();
  expect(screen.queryByText(/邀请人：|由.*邀请/)).toBeNull();
});
