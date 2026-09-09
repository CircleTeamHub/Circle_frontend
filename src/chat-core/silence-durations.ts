import i18n from '@/i18n';
import { formatSilenceDuration } from './message-mappers';

/**
 * 禁言档位(秒);null = 直到解除。服务端只限 60s–30d,档位是客户端的产品选择。
 * 与阅后即焚不同,这里不做跨仓档位表:服务端接受区间内任意秒数,日志按实际秒数显示。
 */
export const SILENCE_DURATION_OPTIONS: readonly (number | null)[] = [
  600,
  3600,
  21_600,
  86_400,
  604_800,
  null,
];

export function silenceDurationLabel(seconds: number | null): string {
  if (seconds === null) {
    return i18n.t('im.silence.indefinite', { defaultValue: '直到解除' });
  }
  return formatSilenceDuration(seconds);
}

type SilenceState = { silenced?: boolean; silencedUntil?: string | null };

/** 到期后的禁言在服务端读侧已按未禁言返回;客户端缓存里的旧值再兜一次。 */
export function isMemberSilencedNow(member: SilenceState, now = Date.now()): boolean {
  if (!member.silenced) return false;
  if (!member.silencedUntil) return true;
  const until = new Date(member.silencedUntil).getTime();
  return Number.isNaN(until) || until > now;
}

/** 成员禁言状态 → 一句状态文案(到期时间 / 直到解除);未禁言返回空串。 */
export function silenceStatusLabel(member: SilenceState): string {
  if (!isMemberSilencedNow(member)) return '';
  if (member.silencedUntil) {
    return i18n.t('chat.silencedUntil', {
      time: new Date(member.silencedUntil).toLocaleString(),
      defaultValue: '禁言至 {{time}}',
    });
  }
  return i18n.t('chat.silencedIndefinitely', { defaultValue: '禁言中，直到解除' });
}
