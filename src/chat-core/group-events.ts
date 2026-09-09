import i18n from '@/i18n';
import { formatSilenceDuration } from './message-mappers';
import type { ChatGroupEventDto, ChatSenderInfo } from './protocol';

/**
 * 群日志一条 → 一行本地化文案(点名:操作者 / 目标昵称由服务端解析好带回来)。
 *
 * 与 systemNoticeText 的「被动不点名」不同:群日志本来就是给人复盘「谁对谁做了
 * 什么」的,所以这里必须点名。未知 kind 兜底「群聊活动」而不是空串 —— 空串在
 * 列表里是一行空卡片。
 */
export function groupEventText(event: ChatGroupEventDto): string {
  const actor = actorName(event.actor);
  const targets = targetNames(event.targets);
  const payload = event.payload ?? {};
  // 不叫 t:i18n-completeness 会把 `t('key'` 当成顶层词条去核对。
  const eventText = (key: string, values?: Record<string, unknown>) =>
    i18n.t(`chat.groupEvent.${key}`, values);

  switch (event.kind) {
    case 'group-created':
      return event.actor
        ? eventText('groupCreated', { actor })
        : eventText('groupCreatedPlain');
    case 'member-joined':
      if (payload['via'] === 'qr') return eventText('memberJoinedQr', { targets });
      return event.actor
        ? eventText('memberJoined', { actor, targets })
        : eventText('memberJoinedPlain', { targets });
    case 'member-left':
      return eventText('memberLeft', { targets });
    case 'member-removed':
      return eventText('memberRemoved', { actor, targets });
    case 'member-role-changed':
      return payload['role'] === 'ADMIN'
        ? eventText('memberPromoted', { actor, targets })
        : eventText('memberDemoted', { actor, targets });
    case 'member-silenced': {
      const durationSec =
        typeof payload['durationSec'] === 'number' ? payload['durationSec'] : null;
      return durationSec
        ? eventText('memberSilenced', {
            actor,
            targets,
            duration: formatSilenceDuration(durationSec),
          })
        : eventText('memberSilencedIndefinitely', { actor, targets });
    }
    case 'member-unsilenced':
      return eventText('memberUnsilenced', { actor, targets });
    case 'owner-transferred':
      return eventText('ownerTransferred', { targets });
    case 'group-renamed': {
      const name = typeof payload['name'] === 'string' ? payload['name'] : '';
      return eventText('groupRenamed', { actor, name });
    }
    case 'group-notice-updated':
      return eventText('groupNoticeUpdated', { actor });
    case 'history-cleared':
      return eventText('historyCleared', { actor });
    default:
      return i18n.t('chat.groupActivity', { defaultValue: '群聊活动' });
  }
}

function displayName(info: ChatSenderInfo): string {
  const nickname = info.nickname?.trim();
  return (
    nickname ||
    i18n.t('chat.groupEvent.unknownMember', { defaultValue: '已注销用户' })
  );
}

function actorName(actor: ChatSenderInfo | null): string {
  return actor
    ? displayName(actor)
    : i18n.t('chat.groupEvent.system', { defaultValue: '系统' });
}

function targetNames(targets: readonly ChatSenderInfo[]): string {
  return targets
    .map(displayName)
    .join(i18n.t('chat.groupEvent.nameSeparator', { defaultValue: '、' }));
}
