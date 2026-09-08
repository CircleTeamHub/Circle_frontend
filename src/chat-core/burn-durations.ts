import i18n from '@/i18n';

/**
 * 阅后即焚时长阶梯 —— 全仓唯一事实源。
 *
 * 在这之前同一个功能有三套互不相同的档位:会话级白名单(30秒/5分/1时/1天/7天)、
 * 全局隐私设置的**天数**白名单(1/2/7/30 天),外加 `chat-info.ts` 里一个谁都没在用、
 * 却自成一套的标签格式化。于是「30 秒」只在单会话里存在、「30 天」只在全局里存在,
 * 两处说的都是同一件事,用户看到的却是两张不一样的表。
 *
 * 现在两处共用这一份;后端 `src/common/burn-durations.ts` 逐值镜像,
 * 由 test/burn-duration-contract.test.js 盯着不许漂。
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** 「1 个月」按 30 天算:焚毁窗口是个时长,不跟自然月的 28/30/31 天走。 */
const MONTH = 30 * DAY;

/** 关闭焚毁。会话级存 null 或 0,全局设置存 0。 */
export const BURN_DURATION_OFF = 0;

export const BURN_DURATION_CHOICES = [
  BURN_DURATION_OFF,
  MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  6 * HOUR,
  DAY,
  2 * DAY,
  3 * DAY,
  4 * DAY,
  5 * DAY,
  6 * DAY,
  WEEK,
  2 * WEEK,
  3 * WEEK,
  MONTH,
] as const;

export type BurnDurationSec = (typeof BURN_DURATION_CHOICES)[number];

/** 档位 → i18n key。缺一个就会在 UI 上露出裸秒数,所以两张表必须同长。 */
const BURN_LABEL_KEYS: Record<number, string> = {
  [MINUTE]: 'im.burn.m1',
  [5 * MINUTE]: 'im.burn.m5',
  [10 * MINUTE]: 'im.burn.m10',
  [30 * MINUTE]: 'im.burn.m30',
  [HOUR]: 'im.burn.h1',
  [2 * HOUR]: 'im.burn.h2',
  [6 * HOUR]: 'im.burn.h6',
  [DAY]: 'im.burn.d1',
  [2 * DAY]: 'im.burn.d2',
  [3 * DAY]: 'im.burn.d3',
  [4 * DAY]: 'im.burn.d4',
  [5 * DAY]: 'im.burn.d5',
  [6 * DAY]: 'im.burn.d6',
  [WEEK]: 'im.burn.w1',
  [2 * WEEK]: 'im.burn.w2',
  [3 * WEEK]: 'im.burn.w3',
  [MONTH]: 'im.burn.mo1',
};

export function isBurnDurationChoice(
  seconds: number | null | undefined,
): seconds is BurnDurationSec {
  return (
    typeof seconds === 'number' &&
    (BURN_DURATION_CHOICES as readonly number[]).includes(seconds)
  );
}

/**
 * 焚毁档位 → 本地化时长标签。
 *
 * 白名单外的值回落成秒数而不是抛错:服务端的档位表可能比这一版客户端新,
 * 老客户端读到新档位时宁可显示得难看,也不能把一条已开焚毁的会话渲染成空白。
 */
export function formatBurnDuration(seconds: number): string {
  const key = BURN_LABEL_KEYS[seconds];
  return key ? i18n.t(key) : `${seconds}s`;
}

/** 选择面板用的 (值, 标签) 列表;0 走「关闭」文案。 */
export function buildBurnDurationOptions(
  t: (key: string) => string,
): { value: BurnDurationSec; label: string }[] {
  return BURN_DURATION_CHOICES.map((value) => ({
    value,
    label: value === BURN_DURATION_OFF ? t('chat.burnOff') : formatBurnDuration(value),
  }));
}
