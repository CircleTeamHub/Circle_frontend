import type { TFunction } from 'i18next';

// 默认 fallback 是 zh 占位。调用方传 `t` 时走 i18n（拿到当前 locale 的字符串）；不传时保持
// 旧行为，避免破坏既有调用点和测试。
const EMPTY_SIGNATURE_FALLBACK = '完善资料后会在这里展示你的介绍。';

export function getProfileSignature(
  persona?: string | null,
  helloWords?: string | null,
  t?: TFunction,
) {
  const nextPersona = persona?.trim();
  const nextHelloWords = helloWords?.trim();
  if (nextPersona) return nextPersona;
  if (nextHelloWords) return nextHelloWords;
  return t
    ? t('profileDisplay.emptySignature', {
        defaultValue: EMPTY_SIGNATURE_FALLBACK,
      })
    : EMPTY_SIGNATURE_FALLBACK;
}
