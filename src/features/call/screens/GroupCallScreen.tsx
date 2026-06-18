import type { ComponentType, PropsWithChildren } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { cancelCall, leaveCall, requestJoinToken } from '@/services/api/calls';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCallStore } from '@/features/call/store/use-call-store';
import { ensureLiveKitGlobals } from '@/utils/livekit-globals';

type LiveKitModule = {
  LiveKitRoom: ComponentType<
    PropsWithChildren<{
      serverUrl: string;
      token: string;
      connect?: boolean;
      audio?: boolean;
      video?: boolean;
      onError?: (error: Error) => void;
    }>
  >;
  useConnectionState: () => string;
  useLocalParticipant: () => {
    localParticipant: {
      identity: string;
      setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
    };
    isMicrophoneEnabled: boolean;
  };
  useParticipants: () => {
    identity: string;
    name?: string;
  }[];
  useRoomContext: () => {
    disconnect: () => Promise<void>;
  };
  registerGlobals?: () => void;
};

let cachedLiveKitModule: LiveKitModule | null | undefined;
let liveKitModulePromise: Promise<LiveKitModule | null> | null = null;

function loadLiveKitModule() {
  if (!NativeModules.WebRTCModule) {
    return Promise.resolve(null);
  }
  if (cachedLiveKitModule !== undefined) {
    return Promise.resolve(cachedLiveKitModule);
  }
  if (liveKitModulePromise) {
    return liveKitModulePromise;
  }

  liveKitModulePromise = import('@livekit/react-native')
    .then((module) => {
      cachedLiveKitModule = module as LiveKitModule;
      if (cachedLiveKitModule.registerGlobals) {
        ensureLiveKitGlobals(cachedLiveKitModule.registerGlobals);
      }
      return cachedLiveKitModule;
    })
    .catch((error) => {
      cachedLiveKitModule = null;
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] LiveKit native module unavailable', error);
      }
      return cachedLiveKitModule;
    });

  return liveKitModulePromise;
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: 72,
    paddingBottom: 40,
    gap: Spacing.xl,
  },
  header: {
    gap: Spacing.sm,
  },
  eyebrow: {
    ...Typography.small,
    fontWeight: '700',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    ...Typography.bodyRegular,
  },
  participantGrid: {
    flex: 1,
    alignContent: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  participant: {
    width: '30%',
    minWidth: 92,
    aspectRatio: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantName: {
    ...Typography.small,
    fontWeight: '700',
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  control: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  missingTitle: {
    ...Typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  backButton: {
    height: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    ...Typography.body,
    fontWeight: '700',
  },
  errorBar: {
    gap: Spacing.sm,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableText: {
    ...Typography.small,
    textAlign: 'center',
  },
});

function initials(name: string) {
  const trimmed = name.trim();
  return trimmed.slice(0, 2).toUpperCase() || '?';
}

function CallRoomContent({ liveKitModule }: { liveKitModule: LiveKitModule }) {
  const {
    useConnectionState,
    useLocalParticipant,
    useParticipants,
    useRoomContext,
  } = liveKitModule;
  const { colors } = useTheme();
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const activeCall = useCallStore((state) => state.activeCall);
  const resetCallState = useCallStore((state) => state.resetCallState);
  const authUser = useAuthStore((state) => state.user);
  const [muting, setMuting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const participantRows = useMemo(
    () =>
      participants.map((participant) => ({
        id: participant.identity,
        name: participant.name || participant.identity,
        isLocal: participant.identity === localParticipant.identity,
      })),
    [localParticipant.identity, participants],
  );
  const connectionLabel = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return 'LiveKit 已连接，当前仅开放音频。';
      case 'reconnecting':
      case 'signalReconnecting':
        return '正在恢复通话连接...';
      case 'connecting':
        return '正在连接 LiveKit...';
      default:
        return '通话连接已断开。';
    }
  }, [connectionState]);

  const handleToggleMic = useCallback(async () => {
    if (muting) return;
    setMuting(true);
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] toggle mic failed', error);
      }
    } finally {
      setMuting(false);
    }
  }, [isMicrophoneEnabled, localParticipant, muting]);

  const handleLeave = useCallback(async () => {
    if (!activeCall || leaving) return;
    setLeaving(true);
    try {
      if (activeCall.status === 'RINGING' && activeCall.initiator.id === authUser?.id) {
        await cancelCall(activeCall.id);
      } else {
        await leaveCall(activeCall.id);
      }
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] leave failed', error);
      }
    } finally {
      await room.disconnect().catch(() => undefined);
      resetCallState();
      setLeaving(false);
      router.back();
    }
  }, [activeCall, authUser?.id, leaving, resetCallState, room]);

  return (
    <>
      <View style={s.header}>
        <Text style={[s.eyebrow, { color: colors.primary }]}>群语音通话</Text>
        <Text style={[s.title, { color: colors.text }]}>
          {participantRows.length} 人在线
        </Text>
        <Text style={[s.subtitle, { color: colors.textSecondary }]}>
          {connectionLabel}
        </Text>
      </View>

      <View style={s.participantGrid}>
        {participantRows.map((participant) => (
          <View
            key={participant.id}
            style={[s.participant, { backgroundColor: colors.surface }]}
          >
            <View style={[s.avatar, { backgroundColor: colors.primaryLight }]}>
              <Text style={[s.participantName, { color: colors.primary }]}>
                {initials(participant.name)}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={[s.participantName, { color: colors.text }]}
            >
              {participant.isLocal ? '我' : participant.name}
            </Text>
          </View>
        ))}
      </View>

      <View style={s.controls}>
        <Pressable
          style={[
            s.control,
            {
              backgroundColor: isMicrophoneEnabled
                ? colors.surface
                : colors.surfaceBorder,
            },
          ]}
          onPress={handleToggleMic}
          disabled={muting || leaving}
        >
          {muting ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons
              name={isMicrophoneEnabled ? 'mic' : 'mic-off'}
              size={24}
              color={colors.text}
            />
          )}
        </Pressable>
        <Pressable
          style={[s.control, { backgroundColor: colors.error }]}
          onPress={handleLeave}
          disabled={leaving}
        >
          {leaving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Ionicons name="call" size={24} color={colors.white} />
          )}
        </Pressable>
      </View>
    </>
  );
}

export default function GroupCallScreen() {
  const { colors } = useTheme();
  const activeCall = useCallStore((state) => state.activeCall);
  const livekit = useCallStore((state) => state.livekit);
  const setLiveKitCredentials = useCallStore((state) => state.setLiveKitCredentials);
  const resetCallState = useCallStore((state) => state.resetCallState);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [roomVersion, setRoomVersion] = useState(0);
  const mountedRef = useRef(true);
  const [liveKitModule, setLiveKitModule] = useState<
    LiveKitModule | null | undefined
  >(() => (NativeModules.WebRTCModule ? cachedLiveKitModule : null));

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (liveKitModule !== undefined) return;

    let cancelled = false;
    loadLiveKitModule().then((module) => {
      if (!cancelled) {
        setLiveKitModule(module);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [liveKitModule]);

  const handleRetryConnection = useCallback(async () => {
    if (!activeCall || retrying) return;
    setRetrying(true);
    try {
      const response = await requestJoinToken(activeCall.id);
      if (!mountedRef.current) return;
      setLiveKitCredentials(response.livekit);
      setConnectError(null);
      setRoomVersion((current) => current + 1);
    } catch (error) {
      if (mountedRef.current && typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] retry connection failed', error);
      }
    } finally {
      if (mountedRef.current) {
        setRetrying(false);
      }
    }
  }, [activeCall, retrying, setLiveKitCredentials]);

  if (!activeCall || !livekit) {
    return (
      <View style={[s.missing, { backgroundColor: colors.background }]}>
        <Text style={[s.missingTitle, { color: colors.text }]}>
          通话已结束或连接信息已失效
        </Text>
        <Pressable
          style={[s.backButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            resetCallState();
            router.back();
          }}
        >
          <Text style={[s.backText, { color: colors.white }]}>返回</Text>
        </Pressable>
      </View>
    );
  }

  if (liveKitModule === undefined) {
    return (
      <View style={[s.missing, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[s.missingTitle, { color: colors.text }]}>
          正在准备通话组件...
        </Text>
      </View>
    );
  }

  if (!liveKitModule) {
    return (
      <View style={[s.missing, { backgroundColor: colors.background }]}>
        <Text style={[s.missingTitle, { color: colors.text }]}>
          LiveKit 通话组件不可用
        </Text>
        <Text style={[s.unavailableText, { color: colors.textSecondary }]}>
          请使用包含 LiveKit native module 的开发客户端或重新构建应用。
        </Text>
        <Pressable
          style={[s.backButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            resetCallState();
            router.back();
          }}
        >
          <Text style={[s.backText, { color: colors.white }]}>返回</Text>
        </Pressable>
      </View>
    );
  }

  const LiveKitRoom = liveKitModule.LiveKitRoom;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <LiveKitRoom
        key={roomVersion}
        serverUrl={livekit.url}
        token={livekit.token}
        connect
        audio
        video={false}
        onError={(error) => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[call] LiveKit room error', error);
          }
          setConnectError('通话连接失败，请重试');
        }}
      >
        <CallRoomContent liveKitModule={liveKitModule} />
      </LiveKitRoom>
      {connectError ? (
        <View style={s.errorBar}>
          <Text style={[Typography.small, { color: colors.error }]}>
            {connectError}
          </Text>
          <Pressable
            style={[s.retryButton, { backgroundColor: colors.primary }]}
            onPress={handleRetryConnection}
            disabled={retrying}
          >
            {retrying ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[s.backText, { color: colors.white }]}>重新连接</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
