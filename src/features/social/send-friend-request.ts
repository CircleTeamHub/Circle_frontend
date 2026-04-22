import i18n from '@/i18n';

export type SendFriendRequestRecipient = {
  nickname?: string | null;
  accountId: string;
};

export function buildSendFriendRequestInitialMessage(
  recipient: SendFriendRequestRecipient,
) {
  const nickname = recipient.nickname?.trim();
  return i18n.t('contacts.request.defaultMessage', {
    name: nickname || recipient.accountId,
  });
}
