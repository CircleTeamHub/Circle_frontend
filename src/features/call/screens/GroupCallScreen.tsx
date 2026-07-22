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
import type { StyleProp, ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { requestJoinToken } from '@/services/api/calls';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCallStore } from '@/features/call/store/use-call-store';
import { leaveActiveCall } from '@/features/call/call-session-teardown';
import { ensureLiveKitGlobals } from '@/utils/livekit-globals';

// useTracks 返回的相机轨引用（只声明用到的字段）。直接透传给同模块的
// VideoTrack，运行时是 @livekit/components-react 的真实 TrackReference。
type LiveKitTrackReference = {
  participant: { identity: string };
  publication?: { isMuted?: boolean };
};

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
  VideoTrack: ComponentType<{
    trackRef: LiveKitTrackReference | undefined;
    style?: StyleProp<ViewStyle>;
    objectFit?: 'cover' | 'contain';
    mirror?: boolean;
  }>;
  useConnectionState: () => string;
  useLocalParticipant: () => {
    localParticipant: {
      identity: string;
      setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
      setCameraEnabled: (enabled: boolean) => Promise<void>;
    };
    isMicrophoneEnabled: boolean;
    isCameraEnabled: boolean;
  };
  // sources 传 Track.Source 的字符串值（'camera'），避免为拿枚举而静态
  // import livekit-client（本文件靠动态 import 保持 LiveKit 可缺席）。
  useTracks: (sources: string[]) => LiveKitTrackReference[];
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
  participantVideoTile: {
    overflow: 'hidden',
    padding: 0,
  },
  participantVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  participantVideoNameBar: {
    position: 'absolute',
    left: Spacing.xs,
    right: Spacing.xs,
    bottom: Spacing.xs,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
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
    useTracks,
    VideoTrack,
  } = liveKitModule;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } =
    useLocalParticipant();
  const activeCall = useCallStore((state) => state.activeCall);
  const isVideoCall = activeCall?.callType === 'VIDEO';
  const [muting, setMuting] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // 'camera' = livekit-client Track.Source.Camera 的枚举字符串值。
  const cameraTracks = useTracks(['camera']);
  const videoTrackByIdentity = useMemo(() => {
    const map = new Map<string, LiveKitTrackReference>();
    for (const trackRef of cameraTracks) {
      if (trackRef.publication?.isMuted) continue;
      map.set(trackRef.participant.identity, trackRef);
    }
    return map;
  }, [cameraTracks]);

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
        return isVideoCall
          ? t('call.livekit.connectedVideo', {
              defaultValue: 'LiveKit 已连接，视频通话进行中。',
            })
          : t('call.livekit.connected', { defaultValue: 'LiveKit 已连接，当前仅开放音频。' });
      case 'reconnecting':
      case 'signalReconnecting':
        return t('call.status.reconnecting', { defaultValue: '正在恢复通话连接...' });
      case 'connecting':
        return t('call.status.connecting', { defaultValue: '正在连接 LiveKit...' });
      default:
        return t('call.status.disconnected', { defaultValue: '通话连接已断开。' });
    }
  }, [connectionState, isVideoCall, t]);

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

  const handleToggleCamera = useCallback(async () => {
    if (cameraBusy) return;
    setCameraBusy(true);
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] toggle camera failed', error);
      }
    } finally {
      setCameraBusy(false);
    }
  }, [cameraBusy, isCameraEnabled, localParticipant]);

  const handleLeave = useCallback(async () => {
    if (!activeCall || leaving) return;
    setLeaving(true);
    try {
      // 通知后端 + 清空本地状态统一走 leaveActiveCall（幂等，内部已吞掉网络错误）。
      await leaveActiveCall();
      await room.disconnect().catch(() => undefined);
    } finally {
      // 无论如何都要放用户离开，不能把人卡在一个转圈的挂断按钮上。
      setLeaving(false);
      router.back();
    }
  }, [activeCall, leaving, room]);

  // 离开通话屏幕（系统返回手势 / router.back / 通话结束导致 LiveKitRoom 卸载）时：
  // 1. leaveActiveCall —— 告诉后端我们走了，否则返回手势离开的人会永远挂在成员列表里
  //    显示为 JOINED。activeCall 已被清空（挂断按钮跑完 / 对端结束通话）时它会自行跳过。
  // 2. disconnect —— 释放麦克风与 WebRTC 房间，否则 mic 可能仍热、房间在后台常驻，
  //    造成隐私泄漏与电量 / 内存泄漏。disconnect 幂等，与手动挂断不冲突。
  useEffect(() => {
    return () => {
      void leaveActiveCall();
      room.disconnect().catch(() => undefined);
    };
  }, [room]);

  return (
    <>
      <View style={s.header}>
        <Text style={[s.eyebrow, { color: colors.primary }]}>
          {isVideoCall
            ? t('call.videoCallTitle', { defaultValue: '视频通话' })
            : t('call.groupCallTitle', { defaultValue: '群语音通话' })}
        </Text>
        <Text style={[s.title, { color: colors.text }]}>
          {t('call.participantsOnline', {
            defaultValue: '{{count}} 人在线',
            count: participantRows.length,
          })}
        </Text>
        <Text style={[s.subtitle, { color: colors.textSecondary }]}>
          {connectionLabel}
        </Text>
      </View>

      <View style={s.participantGrid}>
        {participantRows.map((participant) => {
          const videoTrackRef = videoTrackByIdentity.get(participant.id);
          const displayName = participant.isLocal
            ? t('call.self', { defaultValue: '我' })
            : participant.name;

          if (videoTrackRef) {
            return (
              <View
                key={participant.id}
                style={[
                  s.participant,
                  s.participantVideoTile,
                  { backgroundColor: colors.surface },
                ]}
              >
                <VideoTrack
                  trackRef={videoTrackRef}
                  style={s.participantVideo}
                  objectFit="cover"
                  mirror={participant.isLocal}
                />
                <View
                  style={[
                    s.participantVideoNameBar,
                    { backgroundColor: colors.overlay },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[s.participantName, { color: colors.white }]}
                  >
                    {displayName}
                  </Text>
                </View>
              </View>
            );
          }

          return (
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
                {displayName}
              </Text>
            </View>
          );
        })}
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
        {isVideoCall ? (
          <Pressable
            style={[
              s.control,
              {
                backgroundColor: isCameraEnabled
                  ? colors.surface
                  : colors.surfaceBorder,
              },
            ]}
            onPress={handleToggleCamera}
            disabled={cameraBusy || leaving}
          >
            {cameraBusy ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Ionicons
                name={isCameraEnabled ? 'videocam' : 'videocam-off'}
                size={24}
                color={colors.text}
              />
            )}
          </Pressable>
        ) : null}
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
  const { t } = useTranslation();
  const activeCall = useCallStore((state) => state.activeCall);
  const livekit = useCallStore((state) => state.livekit);
  const setLiveKitCredentials = useCallStore((state) => state.setLiveKitCredentials);
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

  const handleFallbackBack = useCallback(() => {
    void leaveActiveCall();
    router.back();
  }, []);

  if (!activeCall || !livekit) {
    return (
      <View style={[s.missing, { backgroundColor: colors.background }]}>
        <Text style={[s.missingTitle, { color: colors.text }]}>
          {t('call.ended', { defaultValue: '通话已结束或连接信息已失效' })}
        </Text>
        <Pressable
          style={[s.backButton, { backgroundColor: colors.primary }]}
          onPress={handleFallbackBack}
        >
          <Text style={[s.backText, { color: colors.white }]}>
            {t('common.back', { defaultValue: '返回' })}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (liveKitModule === undefined) {
    return (
      <View style={[s.missing, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[s.missingTitle, { color: colors.text }]}>
          {t('call.preparing', { defaultValue: '正在准备通话组件...' })}
        </Text>
      </View>
    );
  }

  if (!liveKitModule) {
    return (
      <View style={[s.missing, { backgroundColor: colors.background }]}>
        <Text style={[s.missingTitle, { color: colors.text }]}>
          {t('call.unavailable', { defaultValue: 'LiveKit 通话组件不可用' })}
        </Text>
        <Text style={[s.unavailableText, { color: colors.textSecondary }]}>
          {t('call.unavailableHint', {
            defaultValue: '请使用包含 LiveKit native module 的开发客户端或重新构建应用。',
          })}
        </Text>
        <Pressable
          style={[s.backButton, { backgroundColor: colors.primary }]}
          onPress={handleFallbackBack}
        >
          <Text style={[s.backText, { color: colors.white }]}>
            {t('common.back', { defaultValue: '返回' })}
          </Text>
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
        video={activeCall.callType === 'VIDEO'}
        onError={(error) => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[call] LiveKit room error', error);
          }
          setConnectError(
            t('call.connectionFailed', { defaultValue: '通话连接失败，请重试' }),
          );
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
              <Text style={[s.backText, { color: colors.white }]}>
                {t('call.reconnect', { defaultValue: '重新连接' })}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
