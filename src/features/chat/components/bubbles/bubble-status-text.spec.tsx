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

const mine = (patch: Partial<ChatMessage>) =>
  ({ id: 'm1', type: 'sent', outgoing: true, sendStatus: 2, ...patch }) as ChatMessage;

// 只分「未读 / 已读」两档。原来「发送中 → 已发送 → 已送达 → 已读」在一两秒内依次跳,
// 每发一条消息状态字都闪几下。
test('sending, sent and delivered all read 未读', () => {
  const { rerender } = render(<BubbleStatusText message={mine({ sendStatus: 1 })} />);
  expect(screen.getByText('未读')).toBeTruthy();
  rerender(<BubbleStatusText message={mine({ isDelivered: false, isRead: false })} />);
  expect(screen.getByText('未读')).toBeTruthy();
  rerender(<BubbleStatusText message={mine({ isDelivered: true, isRead: false })} />);
  expect(screen.getByText('未读')).toBeTruthy();
  for (const gone of ['发送中', '已发送', '已送达']) {
    expect(screen.queryByText(gone)).toBeNull();
  }
});

test('a read message reads 已读', () => {
  render(<BubbleStatusText message={mine({ isDelivered: true, isRead: true })} />);
  expect(screen.getByText('已读')).toBeTruthy();
});

// 发送失败不是进度状态:旁边有红色重发按钮,文字也保留,免得把没发出去的说成「未读」。
test('a failed message still says so', () => {
  render(<BubbleStatusText message={mine({ sendStatus: 3 })} />);
  expect(screen.getByText('发送失败')).toBeTruthy();
});
