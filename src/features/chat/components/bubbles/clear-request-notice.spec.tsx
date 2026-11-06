import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ClearRequestNotice } from './clear-request-notice';
import { respondChatHistoryClear } from '@/chat-core/api';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/chat-core/api', () => ({ respondChatHistoryClear: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_e: unknown, fallback: string) => fallback }));
jest.mock('@/services/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(code: number) { super('api'); this.status = code; }
  }
  return { ApiError };
});
jest.mock('./system-notice-pill', () => {
  const { Text } = jest.requireActual('react-native');
  return { SystemNoticePill: ({ text }: { text: string }) => <Text>{text}</Text> };
});

beforeEach(() => jest.clearAllMocks());

test('the other side sees agree / decline and agreeing answers the request', async () => {
  jest.mocked(respondChatHistoryClear).mockResolvedValue({ accepted: true });
  render(<ClearRequestNotice text="对方申请双向清空聊天记录" requestId="req-1" actionable />);
  await act(async () => { fireEvent.press(screen.getByText('chat.clearRequest.accept')); });
  expect(respondChatHistoryClear).toHaveBeenCalledWith('req-1', true);
  expect(screen.queryByText('chat.clearRequest.accept')).toBeNull();
});

test('declining answers with false', async () => {
  jest.mocked(respondChatHistoryClear).mockResolvedValue({ accepted: false });
  render(<ClearRequestNotice text="对方申请双向清空聊天记录" requestId="req-1" actionable />);
  await act(async () => { fireEvent.press(screen.getByText('chat.clearRequest.decline')); });
  expect(respondChatHistoryClear).toHaveBeenCalledWith('req-1', false);
});

test('a request already answered on another device just hides the buttons', async () => {
  const { ApiError } = jest.requireMock('@/services/api/client');
  jest.mocked(respondChatHistoryClear).mockRejectedValue(new ApiError(409));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<ClearRequestNotice text="对方申请双向清空聊天记录" requestId="req-1" actionable />);
  await act(async () => { fireEvent.press(screen.getByText('chat.clearRequest.accept')); });
  expect(alert).not.toHaveBeenCalled();
  expect(screen.queryByText('chat.clearRequest.accept')).toBeNull();
  alert.mockRestore();
});

test('a failure keeps the buttons so it can be retried', async () => {
  jest.mocked(respondChatHistoryClear).mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<ClearRequestNotice text="对方申请双向清空聊天记录" requestId="req-1" actionable />);
  await act(async () => { fireEvent.press(screen.getByText('chat.clearRequest.accept')); });
  expect(alert).toHaveBeenCalled();
  expect(screen.getByText('chat.clearRequest.accept')).toBeTruthy();
  alert.mockRestore();
});

test('my own request, or one already answered, has no buttons', () => {
  render(<ClearRequestNotice text="你申请了双向清空聊天记录" requestId="req-1" actionable={false} />);
  expect(screen.queryByText('chat.clearRequest.accept')).toBeNull();
});
