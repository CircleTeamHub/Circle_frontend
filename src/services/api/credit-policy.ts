import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import { reportError } from '@/observability/sentry';

export enum CreditPolicyAction {
  SEND_MESSAGE = 'SEND_MESSAGE',
}

export type CreditPolicyBlockCode = 'LOW_CREDIT_SCORE';

export type CreditPolicyDecision = {
  allowed: boolean;
  code: CreditPolicyBlockCode | null;
  currentScore: number;
  minScore: number;
  message: string | null;
};

export type CreditPolicyCheckPayload = {
  action: CreditPolicyAction;
  targetType?: 'SINGLE' | 'GROUP';
  targetId?: string;
};

// 本地快速门槛：仅用于「已知低分」时的即时 UX 拦截，**不是最终授权**。
// 权威判断在后端 credit-policy.service.ts（同名阈值），最终强制应落在服务端发送
// 回调；此常量是后端阈值的镜像，改动需两处同步。所有拦截文案统一由
// buildLowCreditMessage 生成，避免与后端文案漂移。
const SEND_MESSAGE_MIN_SCORE = 60;
const SEND_POLICY_CACHE_TTL_MS = 15_000;

function buildLowCreditMessage(minScore: number): string {
  return `信誉值低于 ${minScore}，暂时无法发送消息`;
}

// 发送是高频操作：若每次被拦/每次分数缺失都上报，会淹没 Sentry。这里按「事件类型」
// 每个 app 生命周期只上报一次，既保留可观测性又不刷量。clear* 用于测试隔离。
const reportedGateEvents = new Set<string>();

function reportGateEventOnce(event: string, context: Record<string, unknown>) {
  if (reportedGateEvents.has(event)) return;
  reportedGateEvents.add(event);
  reportError(new Error(`credit gate: ${event}`), context);
}

export function resetCreditGateTelemetry() {
  reportedGateEvents.clear();
}

const sendPolicyCache = new Map<
  string,
  { decision: CreditPolicyDecision; expiresAt: number }
>();
const sendPolicyInflight = new Map<string, Promise<CreditPolicyDecision>>();

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

export async function checkCreditPolicy(
  payload: CreditPolicyCheckPayload,
): Promise<CreditPolicyDecision> {
  return apiClient<CreditPolicyDecision>('/credit-policy/check', {
    method: 'POST',
    body: payload,
  });
}

export function clearCreditPolicyCache() {
  sendPolicyCache.clear();
  sendPolicyInflight.clear();
}

export function assertLocalCanSendMessage() {
  const localDenied = getLocalLowCreditDecision();
  if (localDenied) {
    // 埋点：可回答「是否有用户因信誉被本地拦截」。currentScore 是自身分数，
    // 非第三方敏感数据；reportError 内部已 sanitize，且永不改变 app 行为。
    reportGateEventOnce('blockSend', {
      operation: 'creditGate',
      op: 'blockSend',
      code: localDenied.code ?? 'LOW_CREDIT_SCORE',
      currentScore: localDenied.currentScore,
      minScore: localDenied.minScore,
    });
    throw new CreditPolicyError(localDenied);
  }
}

function getSendPolicySessionKey() {
  const state = useAuthStore.getState();
  return state.user?.id ?? state.accessToken ?? 'anonymous';
}

function getSendPolicyCacheKey(payload: {
  targetType?: 'SINGLE' | 'GROUP';
  targetId?: string;
}) {
  return [
    getSendPolicySessionKey(),
    CreditPolicyAction.SEND_MESSAGE,
    payload.targetType ?? '',
    payload.targetId ?? '',
  ].join('|');
}

function getLocalLowCreditDecision(): CreditPolicyDecision | null {
  const score = useAuthStore.getState().user?.creditScore;
  // 分数未知（资料未加载 / 字段缺失）：本地放行，交由服务端最终裁决。这是有意的
  // fail-open，但不再静默——上报一次，避免「门槛悄悄失效」无法在生产观测到。
  if (typeof score !== 'number') {
    reportGateEventOnce('scoreUnavailable', {
      operation: 'creditGate',
      op: 'scoreUnavailable',
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

async function getSendPolicyDecision(payload: {
  targetType?: 'SINGLE' | 'GROUP';
  targetId?: string;
}) {
  const localDenied = getLocalLowCreditDecision();
  if (localDenied) return localDenied;

  const cacheKey = getSendPolicyCacheKey(payload);
  const now = Date.now();
  const cached = sendPolicyCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.decision;
  }

  const inflight = sendPolicyInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const request = checkCreditPolicy({
    action: CreditPolicyAction.SEND_MESSAGE,
    ...payload,
  })
    .then((decision) => {
      if (decision.allowed) {
        sendPolicyCache.set(cacheKey, {
          decision,
          expiresAt: Date.now() + SEND_POLICY_CACHE_TTL_MS,
        });
      } else {
        sendPolicyCache.delete(cacheKey);
      }
      return decision;
    })
    .finally(() => {
      sendPolicyInflight.delete(cacheKey);
    });

  sendPolicyInflight.set(cacheKey, request);
  return request;
}

export async function assertCanSendMessage(payload: {
  targetType?: 'SINGLE' | 'GROUP';
  targetId?: string;
}) {
  const decision = await getSendPolicyDecision(payload);
  if (!decision.allowed) {
    throw new CreditPolicyError(decision);
  }
}
