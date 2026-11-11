import type { CallPushNativeEvent } from '../../../../modules/call-push';
import type { CallDismissReason } from '@/features/call/store/use-call-store';
import type {
  CallInvitePayload,
  CallParticipant,
  CallSession,
} from '@/features/call/types';

/** 原生层送来的事件过一遍形状校验：跨了一道边界，字段可能缺、可能是旧版本原生层的。 */
export function parseCallPushEvent(value: unknown): CallPushNativeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type === 'voipToken') return { type: 'voipToken' };
  const callId = event.callId;
  if (typeof callId !== 'string' || callId.length === 0) return null;
  const createdAt = event.createdAt;
  if (createdAt !== undefined && (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)))) return null;
  const call = { callId, ...(createdAt ? { createdAt } : {}) };
  switch (event.type) {
    case 'incoming':
      // 旧版本原生层不带 shown：当作响了（iOS 一律是 CallKit 在响）。
      return { type: 'incoming', ...call, shown: event.shown !== false };
    case 'unavailable':
    case 'answer':
    case 'hangup':
      return { type: event.type, ...call };
    case 'decline':
      return {
        type: 'decline',
        ...call,
        declinedByNative: event.declinedByNative === true,
      };
    case 'end':
      return {
        type: 'end',
        ...call,
        reason: typeof event.reason === 'string' ? event.reason : 'ended',
      };
    default:
      return null;
  }
}

const DISMISS_REASONS: readonly CallDismissReason[] = [
  'ended',
  'canceled',
  'missed',
  'failed',
  'answered_elsewhere',
  'declined_elsewhere',
];

/** 原生层的结束原因（含服务端 call.dismiss 的 reason）落到 store 认得的几种上。 */
export function dismissReasonFromNative(reason: string): CallDismissReason {
  return (DISMISS_REASONS as readonly string[]).includes(reason)
    ? (reason as CallDismissReason)
    : 'ended';
}

/** 服务端的「当前通话」里我还被邀请着、且没过振铃截止：拼回一份邀请交给 store。 */
export function inviteFromCurrentCall(
  current: { call: CallSession; selfParticipant: CallParticipant | null } | null,
  now: number = Date.now(),
): CallInvitePayload | null {
  if (!current || current.selfParticipant?.status !== 'INVITED') return null;
  const { call } = current;
  if (call.status !== 'RINGING' && call.status !== 'ACTIVE') return null;
  const invitationDeadline = current.selfParticipant.invitationExpiresAt ?? call.expiresAt;
  const expiresAt = invitationDeadline ? Date.parse(invitationDeadline) : NaN;
  const invitedAt = current.selfParticipant.invitedAt;
  if (!invitedAt || Number.isNaN(Date.parse(invitedAt)) || Number.isNaN(expiresAt) || expiresAt <= now) return null;
  return {
    callId: call.id,
    conversationID: call.conversationID,
    sessionType: call.sessionType,
    ...(call.invitationMode ? { invitationMode: call.invitationMode } : {}),
    callType: call.callType,
    initiator: call.initiator,
    invitees: call.participants
      .filter((participant) => participant.status === 'INVITED')
      .map((participant) => participant.user),
    expiresAt: invitationDeadline!,
    createdAt: invitedAt,
  };
}

type VoipTokenListener = () => void;
const voipTokenListeners = new Set<VoipTokenListener>();

/** iOS 的 PushKit token 变了：推送登记那边重新跑一次 VoIP 登记。 */
export function subscribeVoipTokenChanges(listener: VoipTokenListener): () => void {
  voipTokenListeners.add(listener);
  return () => {
    voipTokenListeners.delete(listener);
  };
}

export function notifyVoipTokenChanged(): void {
  for (const listener of [...voipTokenListeners]) listener();
}
