export type SendFriendRequestRecipient = {
  nickname?: string | null;
  accountId: string;
};

export function buildSendFriendRequestInitialMessage(
  recipient: SendFriendRequestRecipient,
) {
  const nickname = recipient.nickname?.trim();
  return `你好，我是 ${nickname || recipient.accountId}`;
}
