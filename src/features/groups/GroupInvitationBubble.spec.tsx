import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GroupInvitationBubble } from './GroupInvitationBubble';
import { fetchInvitation } from '@/services/api/circles';

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => { const { useEffect } = jest.requireActual('react'); useEffect(callback, [callback]); } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/features/chat/components/bubbles/shared', () => ({
  MessageAvatar: () => null,
  CompactCardBubble: ({ footer, subtitle, onLongPress }: { footer: string; subtitle: string; onLongPress?: () => void }) => { const { Text, Pressable } = jest.requireActual('react-native'); return <Pressable onLongPress={onLongPress}><Text>{footer}</Text><Text>{subtitle}</Text></Pressable>; },
}));
jest.mock('@/services/api/circles', () => ({ fetchInvitation: jest.fn() }));
jest.mock('@/services/api/group-admissions', () => ({ fetchGroupAdmission: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (state: unknown) => unknown) => select({ user: { id: 'u' } }), { getState: () => ({ user: { id: 'u' } }) }) }));

test('cancelled circle invitation cards retain the cancelled status', async () => {
  jest.mocked(fetchInvitation).mockResolvedValue({ status: 'CANCELLED' } as never);
  const ui = render(<GroupInvitationBubble message={{ groupInvitation: { circleInvitationId: 'c', groupName: 'Circle' } } as never} onPress={jest.fn()} />);
  expect(await ui.findByText('groupAdmission.status.CANCELLED')).toBeTruthy();
});

test.each([[true, 'groupAdmission.sentInvitation'], [false, 'groupAdmission.invitedBy']])('uses the correct invitation perspective for outgoing=%s', async (outgoing, label) => {
  jest.mocked(fetchInvitation).mockResolvedValue({ status: 'INVITED' } as never);
  const ui = render(<GroupInvitationBubble message={{ outgoing, groupInvitation: { circleInvitationId: 'c', groupName: 'Circle' } } as never} senderName="Peer" onPress={jest.fn()} />);
  expect(await ui.findByText(label)).toBeTruthy();
});

test('invitation cards forward long presses to the message action handler', async () => {
  jest.mocked(fetchInvitation).mockResolvedValue({ status: 'INVITED' } as never);
  const handler = jest.fn();
  const ui = render(<GroupInvitationBubble message={{ groupInvitation: { circleInvitationId: 'c', groupName: 'Circle' } } as never} onPress={jest.fn()} onLongPress={handler} />);
  fireEvent(await ui.findByText('groupAdmission.status.INVITED'), 'longPress');
  expect(handler).toHaveBeenCalled();
});
