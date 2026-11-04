import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GroupInvitationBubble } from './GroupInvitationBubble';
import { fetchInvitation } from '@/services/api/circles';
import { fetchGroupAdmission } from '@/services/api/group-admissions';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => { const { useEffect } = jest.requireActual('react'); useEffect(callback, [callback]); } }));
jest.mock('react-i18next', () => {
  const copy = jest.requireActual('@/i18n/locales/zh.json').groupAdmission;
  return { useTranslation: () => ({ t: (key: string, params: Record<string, string> = {}) => {
    const value = key.slice('groupAdmission.'.length).split('.').reduce((node: any, part: string) => node?.[part], copy);
    return typeof value === 'string' ? value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => params[name] ?? '') : key;
  } }) };
});
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/features/chat/components/bubbles/shared', () => ({
  MessageAvatar: () => null,
  CompactCardBubble: ({ footer, subtitle, onPress, onLongPress }: { footer: string; subtitle: string; onPress?: () => void; onLongPress?: () => void }) => { const { Text, Pressable } = jest.requireActual('react-native'); return <Pressable onPress={onPress} onLongPress={onLongPress}><Text>{footer}</Text><Text>{subtitle}</Text></Pressable>; },
}));
jest.mock('@/services/api/circles', () => ({ fetchInvitation: jest.fn() }));
jest.mock('@/services/api/group-admissions', () => ({ fetchGroupAdmission: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (state: unknown) => unknown) => select({ user: { id: 'u' } }), { getState: () => ({ user: { id: 'u' } }) }) }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchInvitation).mockResolvedValue({ status: 'INVITED' } as never);
  jest.mocked(fetchGroupAdmission).mockResolvedValue({ status: 'INVITED' } as never);
});

test('cancelled circle invitation cards retain the cancelled status', async () => {
  jest.mocked(fetchInvitation).mockResolvedValue({ status: 'CANCELLED' } as never);
  const ui = render(<GroupInvitationBubble message={{ groupInvitation: { circleInvitationId: 'c', groupName: 'Circle' } } as never} onPress={jest.fn()} />);
  expect(await ui.findByText('申请已取消')).toBeTruthy();
});

test.each([
  [true, true, '你邀请对方加入圈子'],
  [true, false, 'Peer 邀请你加入圈子'],
  [false, true, '你邀请对方加入群聊'],
  [false, false, 'Peer 邀请你加入群聊'],
])('invitation copy and destination match circle=%s outgoing=%s', async (circle, outgoing, label) => {
  const onPress = jest.fn();
  const groupInvitation = circle ? { circleInvitationId: 'c', groupName: 'Circle' } : { admissionId: 'g', groupName: 'Group' };
  const ui = render(<GroupInvitationBubble message={{ outgoing, groupInvitation } as never} senderName="Peer" onPress={onPress} />);
  expect(await ui.findByText(label)).toBeTruthy();
  fireEvent.press(ui.getByText(label));
  expect(onPress).toHaveBeenCalledWith(circle ? 'c' : 'g', circle);
});

test.each(['APPROVED', 'ADMIN_APPROVED'])('approved circle card status %s names the circle', async (status) => {
  jest.mocked(fetchInvitation).mockResolvedValue({ status } as never);
  const ui = render(<GroupInvitationBubble message={{ groupInvitation: { circleInvitationId: 'c', groupName: 'Circle' } } as never} onPress={jest.fn()} />);
  expect(await ui.findByText('已加入圈子')).toBeTruthy();
  expect(ui.queryByText('已加入群聊')).toBeNull();
});

test('invitation cards forward long presses to the message action handler', async () => {
  jest.mocked(fetchInvitation).mockResolvedValue({ status: 'INVITED' } as never);
  const handler = jest.fn();
  const ui = render(<GroupInvitationBubble message={{ groupInvitation: { circleInvitationId: 'c', groupName: 'Circle' } } as never} onPress={jest.fn()} onLongPress={handler} />);
  fireEvent(await ui.findByText('等待接受邀请'), 'longPress');
  expect(handler).toHaveBeenCalled();
});
