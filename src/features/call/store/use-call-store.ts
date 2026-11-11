import { create } from 'zustand';
import type {
  CallInvitePayload,
  CallLiveKitCredentials,
  CallParticipant,
  CallParticipantPayload,
  CallSession,
  CallStatePayload,
} from '../types';

/** 振铃为什么收掉：交给原生层（iOS CallKit 的结束原因）。 */
export type CallDismissReason =
  | 'ended'
  | 'canceled'
  | 'missed'
  | 'failed'
  | 'answered_elsewhere'
  | 'declined_elsewhere';

/** 记住最近结束 / 收掉的几通：迟到的推送邀请、WS 与推送的重复邀请都不该让它再响。 */
const RECENT_ENDED_LIMIT = 20;

type CallStoreState = {
  incomingCall: CallInvitePayload | null;
  isMinimized: boolean;
  setMinimized: (minimized: boolean) => void;
  updateActiveCall: (call: CallSession) => void;
  activeCall: CallSession | null;
  livekit: CallLiveKitCredentials | null;
  /** 本机正在接听（accept 请求在路上）的那通：WS 先送到「本人已加入」时别把它当成别处接听。 */
  answeringCallId: string | null;
  recentlyEndedCallIds: string[];
  inviteGenerations: Record<string, number>;
  /** 最近一次收掉振铃的原因；原生层据此给 CallKit 报对应的结束原因。 */
  lastDismissal: { callId: string; reason: CallDismissReason; invitationCreatedAt?: string } | null;
  /**
   * 系统来电界面没能接下的那通（iOS 上 CallKit 报错，例如勿扰过滤）：应用内弹窗兜底，
   * 别让它悄悄消失、主叫白响 45 秒。
   */
  nativeUiFallbackCallId: string | null;
  setAnsweringCallId: (callId: string | null) => void;
  setNativeUiFallback: (callId: string) => void;
  /**
   * 本人在另一台设备上接听 / 拒接了这通：本机还在响就收掉。本机正在接听的不动。
   */
  handleSelfParticipantSettled: (
    callId: string,
    reason: Extract<CallDismissReason, 'answered_elsewhere' | 'declined_elsewhere'>,
    changedAt?: string,
  ) => void;
  /**
   * 收掉一通还在振铃的来电（原生层拒接 / 到期 / 撤销推送 / 对账）；已接通的不动。
   * 本机正在接听的那通也不动 —— accept 提交后服务端已把我记成 JOINED，对账与撤销推送都会
   * 说「不再邀请你」，那正是本机接起来了；只有接听失败本身（'failed'）才收。
   */
  dismissIncomingCall: (callId: string, reason: CallDismissReason) => void;
  setActiveCall: (
    call: CallSession | null,
    livekit?: CallLiveKitCredentials | null,
  ) => void;
  setLiveKitCredentials: (livekit: CallLiveKitCredentials | null) => void;
  handleCallInvite: (payload: CallInvitePayload) => void;
  handleCallParticipantJoined: (payload: CallParticipantPayload) => void;
  handleCallParticipantLeft: (payload: CallParticipantPayload) => void;
  handleCallParticipantRejected: (payload: CallParticipantPayload) => void;
  handleCallEnded: (payload: CallStatePayload) => void;
  resetCallState: () => void;
};

function rememberEnded(ids: string[], callId: string): string[] {
  return [...ids.filter((id) => id !== callId), callId].slice(-RECENT_ENDED_LIMIT);
}

function rememberInviteGeneration(generations: Record<string, number>, callId: string, createdAt: number) {
  return Object.fromEntries([
    ...Object.entries(generations).filter(([id]) => id !== callId),
    [callId, createdAt],
  ].slice(-RECENT_ENDED_LIMIT));
}

function callDismissal(generations: Record<string, number>, callId: string, reason: CallDismissReason) {
  const generation = generations[callId];
  return {
    callId,
    reason,
    ...(generation > 0 ? { invitationCreatedAt: new Date(generation).toISOString() } : {}),
  };
}

function reasonForStatus(status: CallStatePayload['status']): CallDismissReason {
  if (status === 'CANCELED') return 'canceled';
  if (status === 'MISSED') return 'missed';
  if (status === 'FAILED') return 'failed';
  return 'ended';
}

function participantFromInvite(
  user: CallInvitePayload['initiator'],
  status: CallParticipant['status'],
  createdAt: string,
): CallParticipant {
  return {
    user,
    status,
    invitedAt: createdAt,
    joinedAt: status === 'JOINED' ? createdAt : null,
    leftAt: null,
  };
}

function callFromInvite(payload: CallInvitePayload): CallSession {
  return {
    id: payload.callId,
    conversationID: payload.conversationID,
    sessionType: payload.sessionType,
    invitationMode: payload.invitationMode,
    callType: payload.callType,
    status: 'RINGING',
    initiator: payload.initiator,
    startedAt: null,
    endedAt: null,
    expiresAt: payload.expiresAt,
    durationSeconds: null,
    endReason: null,
    participants: [
      participantFromInvite(payload.initiator, 'JOINED', payload.createdAt),
      ...payload.invitees.map((user) =>
        ({ ...participantFromInvite(user, 'INVITED', payload.createdAt), invitationExpiresAt: payload.expiresAt }),
      ),
    ],
  };
}

function upsertParticipantJoined(
  participants: CallParticipant[],
  payload: CallParticipantPayload,
): CallParticipant[] {
  const next = participants.map((participant) =>
    participant.user.id === payload.user.id
      ? {
          ...participant,
          status: 'JOINED' as const,
          joinedAt: payload.joinedAt ?? payload.changedAt,
          leftAt: null,
        }
      : participant,
  );

  if (next.some((participant) => participant.user.id === payload.user.id)) {
    return next;
  }

  return [
    ...next,
    {
      user: payload.user,
      status: 'JOINED',
      invitedAt: null,
      joinedAt: payload.joinedAt ?? payload.changedAt,
      leftAt: null,
    },
  ];
}

function predatesInvitation(changedAt: string | undefined, invitedAt: string | null | undefined): boolean {
  return !!changedAt && !!invitedAt && Date.parse(changedAt) < Date.parse(invitedAt);
}

function updateParticipantStatus(
  participants: CallParticipant[],
  payload: CallParticipantPayload,
  status: Extract<CallParticipant['status'], 'LEFT' | 'REJECTED'>,
): CallParticipant[] {
  const leftAt =
    status === 'REJECTED'
      ? payload.rejectedAt ?? payload.changedAt
      : payload.leftAt ?? payload.changedAt;

  return participants.map((participant) =>
    participant.user.id === payload.user.id && !predatesInvitation(payload.changedAt, participant.invitedAt)
      ? {
          ...participant,
          status,
          leftAt,
        }
      : participant,
  );
}

export const useCallStore = create<CallStoreState>((set) => ({
  incomingCall: null,
  isMinimized: false,
  activeCall: null,
  livekit: null,
  answeringCallId: null,
  recentlyEndedCallIds: [],
  inviteGenerations: {},
  lastDismissal: null,
  nativeUiFallbackCallId: null,
  setMinimized: (isMinimized) => set({ isMinimized }),
  updateActiveCall: (call) => set((state) => {
    if (state.incomingCall || state.activeCall?.id !== call.id) return state;
    const current = new Map(state.activeCall.participants.map((participant) => [participant.user.id, participant]));
    return {
      activeCall: {
        ...call,
        participants: call.participants.map((participant) => {
          const prior = current.get(participant.user.id);
          if (!prior) return participant;
          const latestPrior = Math.max(...[prior.invitedAt, prior.joinedAt, prior.leftAt].map((time) => time ? Date.parse(time) : 0));
          const latestIncoming = Math.max(...[participant.invitedAt, participant.joinedAt, participant.leftAt].map((time) => time ? Date.parse(time) : 0));
          return latestPrior > latestIncoming ? prior : participant;
        }),
      },
    };
  }),
  setActiveCall: (call, livekit = null) =>
    set((state) => ({
      activeCall: call,
      isMinimized: false,
      incomingCall: null,
      livekit,
      answeringCallId: null,
      inviteGenerations: call ? rememberInviteGeneration(
        state.inviteGenerations,
        call.id,
        state.inviteGenerations[call.id] ?? Math.max(0, ...call.participants.map(({ invitedAt }) => Date.parse(invitedAt ?? '') || 0)),
      ) : state.inviteGenerations,
    })),
  setLiveKitCredentials: (livekit) => set({ livekit }),
  setAnsweringCallId: (answeringCallId) => set({ answeringCallId }),
  setNativeUiFallback: (callId) =>
    set((state) =>
      state.incomingCall?.callId === callId ? { nativeUiFallbackCallId: callId } : state,
    ),
  // A later invitation into the same ongoing room is a new ringing attempt.
  // Keep its generation so delayed deliveries of the old attempt stay dismissed.
  handleCallInvite: (payload) =>
    set((state) => {
      const generation = Date.parse(payload.createdAt);
      const newerInvite = generation > (state.inviteGenerations[payload.callId] ?? Infinity);
      if (
        (state.recentlyEndedCallIds.includes(payload.callId) && !newerInvite) ||
        (state.incomingCall?.callId === payload.callId && !newerInvite) ||
        (state.activeCall?.id === payload.callId && !state.incomingCall &&
          state.activeCall.status !== 'RINGING')
      ) {
        return state;
      }
      return {
        incomingCall: payload,
        nativeUiFallbackCallId: null,
        inviteGenerations: rememberInviteGeneration(state.inviteGenerations, payload.callId, generation),
        recentlyEndedCallIds: state.recentlyEndedCallIds.filter((id) => id !== payload.callId),
        activeCall: callFromInvite(payload),
        livekit: null,
        answeringCallId: null,
      };
    }),
  handleSelfParticipantSettled: (callId, reason, changedAt) =>
    set((state) => {
      if (
        state.incomingCall?.callId !== callId ||
        state.answeringCallId === callId ||
        predatesInvitation(changedAt, state.incomingCall.createdAt)
      ) {
        return state;
      }
      return {
        incomingCall: null,
        activeCall: state.activeCall?.id === callId ? null : state.activeCall,
        livekit: state.activeCall?.id === callId ? null : state.livekit,
        recentlyEndedCallIds: rememberEnded(state.recentlyEndedCallIds, callId),
        lastDismissal: callDismissal(state.inviteGenerations, callId, reason),
      };
    }),
  dismissIncomingCall: (callId, reason) =>
    set((state) => {
      if (
        state.incomingCall?.callId !== callId ||
        (state.answeringCallId === callId && reason !== 'failed')
      ) {
        return state;
      }
      return {
        incomingCall: null,
        activeCall: state.activeCall?.id === callId ? null : state.activeCall,
        livekit: state.activeCall?.id === callId ? null : state.livekit,
        answeringCallId: state.answeringCallId === callId ? null : state.answeringCallId,
        recentlyEndedCallIds: rememberEnded(state.recentlyEndedCallIds, callId),
        lastDismissal: callDismissal(state.inviteGenerations, callId, reason),
      };
    }),
  handleCallParticipantJoined: (payload) =>
    set((state) => {
      if (!state.activeCall || state.activeCall.id !== payload.callId) {
        return state;
      }
      const current = state.activeCall.participants.find(({ user }) => user.id === payload.user.id);
      if (predatesInvitation(payload.changedAt, current?.invitedAt)) return state;
      return {
        activeCall: {
          ...state.activeCall,
          status: 'ACTIVE',
          participants: upsertParticipantJoined(
            state.activeCall.participants,
            payload,
          ),
        },
      };
    }),
  handleCallParticipantLeft: (payload) =>
    set((state) => {
      if (!state.activeCall || state.activeCall.id !== payload.callId) {
        return state;
      }
      return {
        activeCall: {
          ...state.activeCall,
          participants: updateParticipantStatus(
            state.activeCall.participants,
            payload,
            'LEFT',
          ),
        },
      };
    }),
  handleCallParticipantRejected: (payload) =>
    set((state) => {
      if (!state.activeCall || state.activeCall.id !== payload.callId) {
        return state;
      }
      return {
        activeCall: {
          ...state.activeCall,
          participants: updateParticipantStatus(
            state.activeCall.participants,
            payload,
            'REJECTED',
          ),
        },
      };
    }),
  handleCallEnded: (payload) =>
    set((state) => {
      const recentlyEndedCallIds = rememberEnded(
        state.recentlyEndedCallIds,
        payload.callId,
      );
      if (state.activeCall?.id !== payload.callId) {
        return { recentlyEndedCallIds };
      }
      return {
        incomingCall: null,
        activeCall: null,
        livekit: null,
        answeringCallId: null,
        recentlyEndedCallIds,
        lastDismissal: callDismissal(state.inviteGenerations, payload.callId, reasonForStatus(payload.status)),
      };
    }),
  resetCallState: () =>
    set((state) => {
      const current = state.activeCall?.id ?? state.incomingCall?.callId ?? null;
      return {
        incomingCall: null,
        activeCall: null,
        livekit: null,
        answeringCallId: null,
        recentlyEndedCallIds: current
          ? rememberEnded(state.recentlyEndedCallIds, current)
          : state.recentlyEndedCallIds,
        lastDismissal: current ? callDismissal(state.inviteGenerations, current, 'ended') : null,
      };
    }),
}));
