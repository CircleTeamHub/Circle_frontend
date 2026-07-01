import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';

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

const SEND_MESSAGE_MIN_SCORE = 60;
const SEND_POLICY_CACHE_TTL_MS = 15_000;

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
    super(decision.message ?? '信誉值不足，暂时无法完成该操作');
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
  if (typeof score !== 'number' || score >= SEND_MESSAGE_MIN_SCORE) {
    return null;
  }
  return {
    allowed: false,
    code: 'LOW_CREDIT_SCORE',
    currentScore: score,
    minScore: SEND_MESSAGE_MIN_SCORE,
    message: `信誉值低于 ${SEND_MESSAGE_MIN_SCORE}，暂时无法发送消息`,
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
