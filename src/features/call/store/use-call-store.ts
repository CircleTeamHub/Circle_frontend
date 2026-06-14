import { create } from 'zustand';
import type {
  CallInvitePayload,
  CallLiveKitCredentials,
  CallParticipant,
  CallParticipantPayload,
  CallSession,
  CallStatePayload,
} from '../types';

type CallStoreState = {
  incomingCall: CallInvitePayload | null;
  activeCall: CallSession | null;
  livekit: CallLiveKitCredentials | null;
  setActiveCall: (
    call: CallSession | null,
    livekit?: CallLiveKitCredentials | null,
  ) => void;
  setLiveKitCredentials: (livekit: CallLiveKitCredentials | null) => void;
  handleCallInvite: (payload: CallInvitePayload) => void;
  handleCallParticipantJoined: (payload: CallParticipantPayload) => void;
  handleCallParticipantLeft: (payload: CallParticipantPayload) => void;
  handleCallParticipantRejected: (payload: CallParticipantPayload) => void;
  handleCallParticipantMissed: (payload: CallParticipantPayload) => void;
  handleCallEnded: (payload: CallStatePayload) => void;
  resetCallState: () => void;
};

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
        participantFromInvite(user, 'INVITED', payload.createdAt),
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

function updateParticipantStatus(
  participants: CallParticipant[],
  payload: CallParticipantPayload,
  status: Extract<CallParticipant['status'], 'LEFT' | 'REJECTED' | 'MISSED'>,
): CallParticipant[] {
  const leftAt =
    status === 'REJECTED'
      ? payload.rejectedAt ?? payload.changedAt
      : status === 'MISSED'
        ? payload.missedAt ?? payload.changedAt
        : payload.leftAt ?? payload.changedAt;

  return participants.map((participant) =>
    participant.user.id === payload.user.id
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
  activeCall: null,
  livekit: null,
  setActiveCall: (call, livekit = null) =>
    set({
      activeCall: call,
      incomingCall: null,
      livekit,
    }),
  setLiveKitCredentials: (livekit) => set({ livekit }),
  handleCallInvite: (payload) =>
    set({
      incomingCall: payload,
      activeCall: callFromInvite(payload),
      livekit: null,
    }),
  handleCallParticipantJoined: (payload) =>
    set((state) => {
      if (!state.activeCall || state.activeCall.id !== payload.callId) {
        return state;
      }
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
  handleCallParticipantMissed: (payload) =>
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
            'MISSED',
          ),
        },
      };
    }),
  handleCallEnded: (payload) =>
    set((state) => {
      if (state.activeCall?.id !== payload.callId) {
        return state;
      }
      return {
        incomingCall: null,
        activeCall: null,
        livekit: null,
      };
    }),
  resetCallState: () =>
    set({ incomingCall: null, activeCall: null, livekit: null }),
}));
