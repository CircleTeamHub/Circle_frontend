import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList, StyleSheet } from 'react-native';
import { GroupAdmissionsList } from './GroupAdmissionsList';
import { InboxTabsHeader } from '@/features/contacts/components/InboxTabsHeader';
import { fetchGroupAdmissions } from '@/services/api/group-admissions';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { fetchMyApplications } from '@/services/api/circles';

const mockAuth = { sessionEpoch: 1, user: { id: 'actor' } };
const mockPush = jest.fn();
let mockConversations: any[] = [];
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('react-i18next', () => {
  const copy = jest.requireActual('@/i18n/locales/zh.json').groupAdmission;
  const t = (key: string, params: Record<string, unknown> = {}) => {
    const value = key.startsWith('groupAdmission.')
      ? key.slice('groupAdmission.'.length).split('.').reduce((node: any, part: string) => node?.[part], copy)
      : undefined;
    return typeof value === 'string'
      ? value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(params[name] ?? ''))
      : key;
  };
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((select: (s: unknown) => unknown) => select(mockAuth), { getState: () => mockAuth }),
}));
jest.mock('@/chat-core/store', () => ({ useChatStore: (select: (s: unknown) => unknown) => select({ conversations: mockConversations }) }));
jest.mock('@/chat-core/api', () => ({ loadChatConversations: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/chat-core/mappers', () => ({ mapChatConversationToUI: jest.fn() }));
jest.mock('@/features/notifications/store/use-notification-center-store', () => ({
  useNotificationCenterStore: (select: (s: unknown) => unknown) => select({ interactive: [] }),
}));
jest.mock('@/services/api/group-admissions', () => ({ fetchGroupAdmissions: jest.fn(), refreshGroupAdmissionUnread: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api/circles', () => ({ fetchMyApplications: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_: unknown, fallback: string) => fallback }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/theme', () => ({
  Radius: { xxl: 24, pill: 999 }, Spacing: { lg: 16, md: 8, sm: 4, xs: 2 }, Typography: { h3: {}, bodyRegular: {} },
  useTheme: () => ({ colors: { text: '#111', primary: '#00f', white: '#fff', badgeUnread: '#f00', textSecondary: '#555' } }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConversations = [];
  jest.mocked(mapChatConversationToUI).mockImplementation((c: any) => ({ name: c.name, sourceID: c.circleId ?? c.id, unreadCount: c.unreadCount }) as any);
  jest.mocked(fetchMyApplications).mockResolvedValue([]);
});

test('tab count is beside the label and the underline stays below both', () => {
  const ui = render(<InboxTabsHeader tabs={[{ id: 'groups', label: '新的群组', unreadCount: 1 }]} activeId="groups" onSelect={jest.fn()} query="" onQueryChange={jest.fn()} searchPlaceholder="搜索" />);
  const row = ui.getByTestId('inbox-tab-label-groups');
  expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
  expect(StyleSheet.flatten(row.props.style).alignItems).toBe('center');
  expect(row.findAllByProps({ children: '新的群组' }).length).toBeGreaterThan(0);
  expect(row.findAllByProps({ children: '1' }).length).toBeGreaterThan(0);
});

test('each group or circle invitation uses its own server unread count, including on cold load', async () => {
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [
    { id: 'unread', unreadCount: 2, kind: 'INVITE', status: 'INVITED', group: { name: '未读群', avatarUrl: null } },
    { id: 'read', unreadCount: 0, kind: 'INVITE', status: 'INVITED', group: { name: '已读群', avatarUrl: null } },
  ] as any, nextCursor: null });
  jest.mocked(fetchMyApplications).mockResolvedValue([
    { id: 'circle', circleName: '未读圈', unreadCount: 1, status: 'INVITED', inviter: { nickname: '邀请人' }, applicant: { nickname: '本人' } },
  ] as any);
  const ui = render(<GroupAdmissionsList />);
  await waitFor(() => expect(ui.getByTestId('group-inbox-unread-unread', { includeHiddenElements: true })).toBeTruthy());
  expect(ui.queryByTestId('group-inbox-unread-read', { includeHiddenElements: true })).toBeNull();
  expect(ui.getByTestId('group-inbox-unread-circle-circle', { includeHiddenElements: true })).toBeTruthy();
  fireEvent.press(ui.getByText('未读群'));
  expect(mockPush).toHaveBeenCalled();
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [
    { id: 'unread', unreadCount: 0, kind: 'INVITE', status: 'INVITED', group: { name: '未读群', avatarUrl: null } },
  ] as any, nextCursor: null });
  const list = ui.UNSAFE_getByType(FlatList);
  await waitFor(() => expect(ui.UNSAFE_getByType(FlatList).props.refreshing).toBe(false));
  fireEvent(list, 'refresh');
  await waitFor(() => expect(ui.UNSAFE_getByType(FlatList).props.data.find((r: any) => r.admission?.id === 'unread')?.unreadCount).toBe(0));
  await waitFor(() => expect(ui.queryByTestId('group-inbox-unread-unread', { includeHiddenElements: true })).toBeNull());
});


test('inviter, recipient and reviewing manager see the correct people and membership subject', async () => {
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [
    { id: 'outgoing', applicantId: 'guest', inviterId: 'actor', isApplicant: false, applicantName: '小王', inviterName: '丁哥很低调', kind: 'INVITE', status: 'JOINED', group: { name: '发出的邀请' } },
    { id: 'incoming', applicantId: 'actor', inviterId: 'other', isApplicant: true, applicantName: '丁哥很低调', inviterName: '小李', kind: 'INVITE', status: 'INVITED', group: { name: '收到的邀请' } },
    { id: 'review', applicantId: 'guest', inviterId: 'other', isApplicant: false, applicantName: '小王', inviterName: '小李', kind: 'INVITE', status: 'PENDING', group: { name: '管理员看到的邀请' } },
  ] as any, nextCursor: null });
  const ui = render(<GroupAdmissionsList />);
  await ui.findByText('你邀请小王加入群聊 · 小王：已加入群聊');
  expect(ui.getByText('小李 邀请你加入群聊 · 等待接受邀请')).toBeTruthy();
  expect(ui.getByText('小李 邀请小王加入群聊 · 小王：已提交，等待管理员审核')).toBeTruthy();
  expect(ui.queryByText(/丁哥很低调 邀请你加入群聊/)).toBeNull();
});


test('one group row combines history and joined chat, uses newest update, and preserves all unread counts', async () => {
  mockConversations = [{ id: 'g', type: 'GROUP', name: '同一个群', unreadCount: 3 }];
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [
    { id: 'older', conversationId: 'g', applicantId: 'actor', isApplicant: true, kind: 'INVITE', status: 'INVITED', createdAt: '2026-10-14T02:00:00Z', updatedAt: '2026-10-14T02:00:00Z', unreadCount: 1, group: { id: 'g', name: '同一个群' } },
    { id: 'latest', conversationId: 'g', applicantId: 'actor', isApplicant: true, kind: 'INVITE', status: 'JOINED', inviterName: '小李', createdAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T03:00:00Z', unreadCount: 2, group: { id: 'g', name: '同一个群', isMember: true } },
  ] as any, nextCursor: null });
  const ui = render(<GroupAdmissionsList includeJoined />);
  await ui.findByText('小李 邀请你加入群聊 · 已加入群聊');
  expect(ui.getAllByText('同一个群')).toHaveLength(1);
  expect(ui.queryByText(/等待接受邀请/)).toBeNull();
  const list = ui.UNSAFE_getByType(FlatList);
  expect(list.props.data[0].key).toBe('group-g');
  expect(list.props.data[0].unreadCount).toBe(6);
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [
    { id: 'latest', conversationId: 'g', applicantId: 'actor', isApplicant: true, kind: 'INVITE', status: 'PENDING', updatedAt: '2026-10-14T04:00:00Z', group: { id: 'g', name: '同一个群' } },
  ] as any, nextCursor: null });
  fireEvent(list, 'refresh');
  await ui.findByText(/已提交，等待管理员审核/);
  expect(ui.getAllByText('同一个群')).toHaveLength(1);
  expect(ui.UNSAFE_getByType(FlatList).props.data[0].key).toBe('group-g');
});

test('circle invitations and their joined circle conversation also share one row', async () => {
  mockConversations = [{ id: 'chat-circle', circleId: 'circle-id', type: 'GROUP', name: '同一个圈' }];
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(fetchMyApplications).mockResolvedValue([{ id: 'inv-circle', circleId: 'circle-id', circleName: '同一个圈', status: 'INVITED', inviter: {}, applicant: {} }] as any);
  const ui = render(<GroupAdmissionsList includeJoined />);
  await ui.findByText('等待接受邀请');
  expect(ui.getAllByText('同一个圈')).toHaveLength(1);
});

test('a scoped manager view retains separate applicants for individual approval', async () => {
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: ['one', 'two'].map(id => ({ id, conversationId: 'g', kind: 'APPLICATION', applicantId: id, applicantName: id, status: 'PENDING', group: { id: 'g', name: '审核群' } })) as any, nextCursor: null });
  const ui = render(<GroupAdmissionsList groupId="g" />);
  await waitFor(() => expect(ui.getAllByText('审核群')).toHaveLength(2));
});


test('leaving then receiving a new invitation or application keeps one row and ignores stale joined-chat unread', async () => {
  mockConversations = [{ id: 'g-rejoin', type: 'GROUP', name: '重新入群', unreadCount: 9 }];
  const old = { id: 'old', conversationId: 'g-rejoin', applicantId: 'actor', isApplicant: true, kind: 'INVITE', status: 'LEFT', updatedAt: '2026-10-14T01:00:00Z', unreadCount: 0, group: { id: 'g-rejoin', name: '重新入群', isMember: false } };
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [old] as any, nextCursor: null });
  const ui = render(<GroupAdmissionsList includeJoined />);
  await ui.findByText(/已退出群聊/);
  expect(ui.getAllByText('重新入群')).toHaveLength(1);
  expect(ui.UNSAFE_getByType(FlatList).props.data[0].unreadCount).toBe(0);
  const invited = { ...old, id: 'new', status: 'INVITED', updatedAt: '2026-10-14T02:00:00Z', unreadCount: 1, inviterName: '小李' };
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [invited, old] as any, nextCursor: null });
  fireEvent(ui.UNSAFE_getByType(FlatList), 'refresh');
  await ui.findByText('小李 邀请你加入群聊 · 等待接受邀请');
  expect(ui.getAllByText('重新入群')).toHaveLength(1);
  expect(ui.queryByText(/已退出群聊/)).toBeNull();
  expect(ui.UNSAFE_getByType(FlatList).props.data[0].unreadCount).toBe(1);
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [{ ...invited, kind: 'APPLICATION', status: 'PENDING', applicantName: '本人', unreadCount: 0 }, old] as any, nextCursor: null });
  fireEvent(ui.UNSAFE_getByType(FlatList), 'refresh');
  await ui.findByText(/申请人：本人 · 已提交，等待管理员审核/);
  expect(ui.getAllByText('重新入群')).toHaveLength(1);
  expect(ui.UNSAFE_getByType(FlatList).props.data[0].unreadCount).toBe(0);
});


test.each([['APPROVED','已加入群聊'],['ADMIN_APPROVED','已加入群聊'],['REJECTED','申请未通过'],['CANCELLED','申请已取消']])('circle status %s is rendered accurately', async (status, label) => {
  jest.mocked(fetchGroupAdmissions).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(fetchMyApplications).mockResolvedValue([{ id: 'status-circle', circleId: 'circle', circleName: '圈', status, inviter: {}, applicant: {} }] as any);
  const ui = render(<GroupAdmissionsList />);
  await ui.findByText(label);
  expect(ui.queryByText('已提交，等待管理员审核')).toBeNull();
});
