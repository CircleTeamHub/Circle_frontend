import type { MessageItem } from '@openim/rn-client-sdk';

export const DEFAULT_NOTIFICATION_RESTORE_MAX_MESSAGES = 500;
export const TARGETED_NOTIFICATION_RESTORE_MAX_MESSAGES = 2000;

export function getNotificationRestoreMaxMessages(searchedMsgID: string) {
  return searchedMsgID
    ? TARGETED_NOTIFICATION_RESTORE_MAX_MESSAGES
    : DEFAULT_NOTIFICATION_RESTORE_MAX_MESSAGES;
}

export function hasMessageWithClientID(
  messages: readonly Pick<MessageItem, 'clientMsgID'>[],
  clientMsgID: string,
) {
  return Boolean(
    clientMsgID &&
      messages.some((message) => message.clientMsgID === clientMsgID),
  );
}
