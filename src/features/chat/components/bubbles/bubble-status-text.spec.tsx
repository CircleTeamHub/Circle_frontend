import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { ChatMessage } from '@/types';
import { BubbleStatusText } from './shared';

jest.mock('@/storage', () => ({ storage: { getString: jest.fn(), set: jest.fn() } }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: jest.fn() },
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

const sent = (patch: Partial<ChatMessage>) =>
  ({ id: 'm1', type: 'sent', outgoing: true, sendStatus: 2, ...patch }) as ChatMessage;

// 发出后到对端设备回执之间通常只有零点几秒:这一段原来显示「未读」,
// 于是每条消息都会「发送中 → 未读 → 已送达」闪一下。
test('a message the server took but the peer has not received yet reads 已发送', () => {
  render(<BubbleStatusText message={sent({ isDelivered: false, isRead: false })} />);
  expect(screen.getByText('已发送')).toBeTruthy();
  expect(screen.queryByText('未读')).toBeNull();
});

test('delivery and read receipts still win over 已发送', () => {
  const { rerender } = render(<BubbleStatusText message={sent({ isDelivered: true })} />);
  expect(screen.getByText('已送达')).toBeTruthy();
  rerender(<BubbleStatusText message={sent({ isDelivered: true, isRead: true })} />);
  expect(screen.getByText('已读')).toBeTruthy();
});
