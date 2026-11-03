import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import InvitationVerificationScreen from './InvitationVerificationScreen';
import { fetchInvitation, respondToCircleInvitation } from '@/services/api/circles';
import type { CircleInvitation } from '@/types';

let mockViewerId = 'applicant';
let mockInvitationId = 'invitation';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockInvitationId }),
  useRouter: () => ({ push: jest.fn() }),
  useSegments: () => ['(tabs)', 'discover'],
}));
jest.mock('react-i18next', () => {
  const t = (key: string, options?: { approved?: number; total?: number }) =>
    key === 'invitation.progress' ? `${options?.approved}/${options?.total}` : key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/features/user/utils/routes', () => ({
  getCircleScopeFromSegments: () => 'discover', getSelectVerifierHref: jest.fn(),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: mockViewerId } }),
}));
jest.mock('@/services/api/circles', () => ({
  fetchInvitation: jest.fn(), respondToCircleInvitation: jest.fn(),
  markCircleInvitationSeen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/services/api/group-admissions', () => ({
  refreshGroupAdmissionUnread: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/notifications/utils/seen-target', () => ({
  markMatchingTargetNotificationsRead: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/theme', () => ({
  Radius: { full: 999 }, Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { body: {}, caption: {}, h2: {}, tinyRegular: {} },
  useTheme: () => ({ colors: { background: '#fff', textSecondary: '#555', primary: '#00f' } }),
}));

const applicant = { id: 'applicant', nickname: 'Applicant', avatarUrl: null, accountId: 'a' };
const inviter = { ...applicant, id: 'inviter', nickname: 'Inviter' };
const pending: CircleInvitation = {
  id: 'invitation', circleId: 'circle', circleName: 'Circle', applicant, inviter,
  status: 'PENDING', approvedCount: 0, requiredCount: 10, verifiers: [], createdAt: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockViewerId = 'applicant';
  mockInvitationId = 'invitation';
  jest.mocked(fetchInvitation).mockResolvedValue(pending);
  jest.mocked(respondToCircleInvitation).mockResolvedValue(pending);
});

it('repairs the applicant’s historical pending invitation and displays refreshed progress', async () => {
  const repaired: CircleInvitation = { ...pending, approvedCount: 1, verifiers: [{
    id: 'seat', verifier: inviter, status: 'APPROVED', respondedAt: '',
  }] };
  jest.mocked(fetchInvitation).mockResolvedValueOnce(pending).mockResolvedValue(repaired);
  jest.mocked(respondToCircleInvitation).mockResolvedValue(repaired);
  render(<InvitationVerificationScreen />);
  await screen.findByText('1/10');
  expect(respondToCircleInvitation).toHaveBeenCalledTimes(1);
  expect(respondToCircleInvitation).toHaveBeenCalledWith('invitation', true);
  expect(fetchInvitation).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Inviter')).toBeTruthy();
});

it.each(['viewer', 'self', 'existing-seat', 'invited', 'approved'])(
  'does not attempt a pending repair for %s', async (kind) => {
    const data = { ...pending };
    if (kind === 'viewer') mockViewerId = 'other';
    if (kind === 'self') data.inviter = applicant;
    if (kind === 'existing-seat') data.verifiers = [{ id: 'seat', verifier: inviter, status: 'REJECTED', respondedAt: '' }];
    if (kind === 'invited') data.status = 'INVITED';
    if (kind === 'approved') data.approvedCount = 1;
    jest.mocked(fetchInvitation).mockResolvedValue(data);
    render(<InvitationVerificationScreen />);
    await screen.findByText(`${data.approvedCount}/10`);
    expect(respondToCircleInvitation).not.toHaveBeenCalled();
  },
);

it.each(['unchanged', 'failed'])('does not repeat an impossible %s repair after reloading', async (outcome) => {
  if (outcome === 'failed') jest.mocked(respondToCircleInvitation).mockRejectedValue(new Error('Unavailable'));
  const view = render(<InvitationVerificationScreen />);
  await screen.findByText('0/10');
  expect(respondToCircleInvitation).toHaveBeenCalledTimes(1);
  mockInvitationId = 'other-invitation';
  jest.mocked(fetchInvitation).mockResolvedValue({ ...pending, id: mockInvitationId, inviter: applicant });
  view.rerender(<InvitationVerificationScreen />);
  await waitFor(() => expect(fetchInvitation).toHaveBeenCalledWith('other-invitation'));
  mockInvitationId = 'invitation';
  jest.mocked(fetchInvitation).mockResolvedValue(pending);
  const previousFetches = jest.mocked(fetchInvitation).mock.calls.length;
  view.rerender(<InvitationVerificationScreen />);
  await waitFor(() => expect(fetchInvitation).toHaveBeenCalledTimes(previousFetches + 1));
  expect(respondToCircleInvitation).toHaveBeenCalledTimes(1);
});
