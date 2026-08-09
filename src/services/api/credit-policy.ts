import i18n from '@/i18n';
import { useAuthStore } from '@/stores/authStore';
import { reportError } from '@/observability/sentry';

export type CreditPolicyBlockCode = 'LOW_CREDIT_SCORE';

export type CreditPolicyDecision = {
  allowed: boolean;
  code: CreditPolicyBlockCode | null;
  currentScore: number;
  minScore: number;
  message: string | null;
};

// 本地发言门槛：低于此分即在客户端拦截发送（UX 层，可被绕过——服务端不强制聊天，
// 见 circle_be docs/credit-gate.md 的 Option A 决策）。此常量镜像后端同名阈值，改动
// 需两处同步。拦截文案统一由 buildLowCreditMessage 生成。
const SEND_MESSAGE_MIN_SCORE = 60;

/**
 * 开发者可见的兜底文案(Error.message / 日志 / Sentry)。**不要拿它上屏** ——
 * 它是硬编码中文,英/西/日/韩用户会看到一句中文。展示一律走
 * getCreditPolicyMessage,那里按当前语言取词条。
 */
function buildLowCreditMessage(minScore: number): string {
  return `信誉值低于 ${minScore}，暂时无法发送消息`;
}

/**
 * 拒绝原因 → 当前语言的一句展示文案。
 *
 * 用全局 i18n.t 而非组件 t:调用点都在 catch/事件回调里,按调用时机取语言,
 * 不在渲染期(与 send-errors 同一套)。
 */
export function getCreditPolicyMessage(decision: {
  minScore: number;
}): string {
  return i18n.t('chat.lowCreditScore', {
    minScore: decision.minScore,
    defaultValue: buildLowCreditMessage(decision.minScore),
  });
}

// 发送是高频操作：若每次被拦/每次分数缺失都上报，会淹没 Sentry。这里按「事件类型」
// 每个 app 生命周期只上报一次，既保留可观测性又不刷量。reset 用于测试隔离。
const reportedGateEvents = new Set<string>();

function reportGateEventOnce(event: string, context: Record<string, unknown>) {
  if (reportedGateEvents.has(event)) return;
  reportedGateEvents.add(event);
  reportError(new Error(`credit gate: ${event}`), context);
}

export function resetCreditGateTelemetry() {
  reportedGateEvents.clear();
}

export class CreditPolicyError extends Error {
  readonly code: CreditPolicyBlockCode;
  readonly currentScore: number;
  readonly minScore: number;

  constructor(decision: CreditPolicyDecision) {
    super(decision.message ?? buildLowCreditMessage(decision.minScore));
    this.name = 'CreditPolicyError';
    this.code = decision.code ?? 'LOW_CREDIT_SCORE';
    this.currentScore = decision.currentScore;
    this.minScore = decision.minScore;
  }
}

export function getLocalLowCreditDecision(): CreditPolicyDecision | null {
  const score = useAuthStore.getState().user?.creditScore;
  // 分数未知（资料未加载 / 字段缺失）：本地放行。这是有意的 fail-open，但不再静默——
  // 上报一次，避免「门槛悄悄失效」无法在生产观测到。
  if (typeof score !== 'number') {
    reportGateEventOnce('scoreUnavailable', {
      operation: 'creditGate',
      kind: 'scoreUnavailable',
    });
    return null;
  }
  if (score >= SEND_MESSAGE_MIN_SCORE) {
    return null;
  }
  return {
    allowed: false,
    code: 'LOW_CREDIT_SCORE',
    currentScore: score,
    minScore: SEND_MESSAGE_MIN_SCORE,
    message: buildLowCreditMessage(SEND_MESSAGE_MIN_SCORE),
  };
}

export function assertLocalCanSendMessage() {
  const localDenied = getLocalLowCreditDecision();
  if (localDenied) {
    // 埋点：可回答「是否有用户因信誉被本地拦截」。currentScore 是自身分数，
    // 非第三方敏感数据；reportError 内部已 sanitize，且永不改变 app 行为。
    reportGateEventOnce('blockSend', {
      operation: 'creditGate',
      kind: 'blockSend',
      code: localDenied.code ?? 'LOW_CREDIT_SCORE',
      currentScore: localDenied.currentScore,
      minScore: localDenied.minScore,
    });
    throw new CreditPolicyError(localDenied);
  }
}
