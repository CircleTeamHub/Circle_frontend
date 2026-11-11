import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestJoinToken } from '@/services/api/calls';
import { showTopNotice } from '@/components/app/top-notice-store';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useCallStore } from '@/features/call/store/use-call-store';
import { leaveActiveCall } from '@/features/call/call-session-teardown';
import {
  getInitialLiveKitModule,
  loadLiveKitModule,
  type LiveKitModule,
  type LiveKitTrackReference,
} from '@/features/call/livekit-module';
import { reportError } from '@/observability/sentry';
import { reportHandledFailure } from '@/observability/report-failure';
import { devWarn } from '@/utils/dev-log';
import type { CallTelemetry } from '@/features/call/call-telemetry';
import {
  useCallRoomTelemetry,
  useCallTelemetry,
} from '@/features/call/use-call-telemetry';
import { VoiceCallContent, VOICE_CALL_BACKGROUND } from '@/features/call/components/VoiceCallContent';
import { MiniCallWindow } from '@/features/call/components/MiniCallWindow';
import { CallInvitePicker } from '@/features/call/components/CallInvitePicker';


const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  callBody: { flex: 1, gap: Spacing.xl },
  hidden: { display: 'none' },
  videoTopActions: { flexDirection: 'row', justifyContent: 'space-between' },
  topAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: 72,
    paddingBottom: 40,
    gap: Spacing.xl,
  },
  voiceContainer: {
    flex: 1,
    backgroundColor: VOICE_CALL_BACKGROUND,
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
  voiceErrorBar: {
    paddingHorizontal: Spacing.lg,
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

// 同屏最多渲染的视频瓦片数（本地优先）。9 宫格再往上就该做分页/焦点视图，
// 当前产品形态（小群）先钉住资源上界。
const MAX_VIDEO_TILES = 9;
/** livekit DisconnectReason.CLIENT_INITIATED。 */
const CLIENT_INITIATED_DISCONNECT = 1;

function initials(name: string) {
  const trimmed = name.trim();
  return trimmed.slice(0, 2).toUpperCase() || '?';
}

function CallRoomContent({
  liveKitModule,
  callTelemetry,
  minimized,
  onMinimize,
  onRestore,
  onInvite,
}: {
  liveKitModule: LiveKitModule;
  callTelemetry: CallTelemetry;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onInvite: () => void;
}) {
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
  useCallRoomTelemetry(room, connectionState, callTelemetry);
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
    // review P2：大群里无上限渲染视频轨会吃满带宽/内存。本地画面优先，
    // 之后按轨道顺序取到上限；超出者回退头像瓦片（音频不受影响）。
    const map = new Map<string, LiveKitTrackReference>();
    // review P2：语音通话不渲染任何相机轨 —— 异常端在 AUDIO 房间里发布摄像
    // 头也不能把视频塞进语音 UI（adaptiveStream 会因不渲染而暂停其下行）。
    if (!isVideoCall) return map;
    const localIdentity = localParticipant.identity;
    const ordered = [...cameraTracks].sort((a, b) => {
      if (a.participant.identity === localIdentity) return -1;
      if (b.participant.identity === localIdentity) return 1;
      return 0;
    });
    for (const trackRef of ordered) {
      if (map.size >= MAX_VIDEO_TILES) break;
      if (trackRef.publication?.isMuted) continue;
      map.set(trackRef.participant.identity, trackRef);
    }
    return map;
  }, [cameraTracks, isVideoCall, localParticipant.identity]);

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
      reportHandledFailure('call', 'toggleMic', error);
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
      reportHandledFailure('call', 'toggleCamera', error);
    } finally {
      setCameraBusy(false);
    }
  }, [cameraBusy, isCameraEnabled, localParticipant]);

  const handleLeave = useCallback(async () => {
    if (!activeCall || leaving) return;
    setLeaving(true);
    try {
      // leaveActiveCall 会清空 activeCall、让 LiveKitRoom 卸载，之后 room.disconnect()
      // 发出的 Disconnected 已经没人收：本端挂断在这里先记下。
      callTelemetry.disconnected(CLIENT_INITIATED_DISCONNECT);
      // 通知后端 + 清空本地状态统一走 leaveActiveCall（幂等，内部已吞掉网络错误）。
      await leaveActiveCall();
    } finally {
      setLeaving(false);
    }
  }, [activeCall, callTelemetry, leaving]);

  // 旧房间卸载时释放媒体资源。重试连接也会换房间，但仍是同一通电话。
  useEffect(() => {
    return () => {
      room.disconnect().catch(() => undefined);
    };
  }, [room]);

  const miniWindow = minimized && activeCall ? (
    <MiniCallWindow call={activeCall} connectionState={connectionState} leaving={leaving} onRestore={onRestore} onLeave={handleLeave} />
  ) : null;

  if (activeCall && !isVideoCall) {
    return (
      <>
        <View style={minimized ? s.hidden : s.callBody}>
          <VoiceCallContent
            key={activeCall.id}
            call={activeCall}
            participants={participants}
            localIdentity={localParticipant.identity}
            connectionState={connectionState}
            micEnabled={isMicrophoneEnabled}
            muting={muting}
            leaving={leaving}
            onToggleMic={handleToggleMic}
            onLeave={handleLeave}
            minimized={minimized}
            onMinimize={onMinimize}
            onInvite={onInvite}
            setSpeakerphone={liveKitModule.setSpeakerphone}
          />
        </View>
        {miniWindow}
      </>
    );
  }

  return (
    <>
      <View style={minimized ? s.hidden : s.callBody}>
      <View style={s.videoTopActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('call.window.minimize')} onPress={onMinimize} style={s.topAction}>
          <Ionicons name="copy-outline" size={25} color={colors.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('call.invite.addTitle')} disabled={activeCall?.status !== 'ACTIVE'} onPress={onInvite} style={s.topAction}>
          <Ionicons name="add" size={30} color={colors.text} />
        </Pressable>
      </View>
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
      </View>
      {miniWindow}
    </>
  );
}

function ActiveCallSession() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeCall = useCallStore((state) => state.activeCall);
  const livekit = useCallStore((state) => state.livekit);
  const setLiveKitCredentials = useCallStore((state) => state.setLiveKitCredentials);
  const activeCallId = activeCall?.id;
  const minimized = useCallStore((state) => state.isMinimized);
  const setMinimized = useCallStore((state) => state.setMinimized);
  const updateActiveCall = useCallStore((state) => state.updateActiveCall);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [roomVersion, setRoomVersion] = useState(0);
  // 通话质量遥测：一个 LiveKitRoom（roomVersion）一份。必须在所有提前 return 之前。
  const callTelemetry = useCallTelemetry(roomVersion);
  const mountedRef = useRef(true);
  const reportedRoomErrorRef = useRef(false);
  const [liveKitModule, setLiveKitModule] = useState<
    LiveKitModule | null | undefined
  >(() => getInitialLiveKitModule());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeCallId || liveKitModule !== undefined) return;

    let cancelled = false;
    loadLiveKitModule().then((module) => {
      if (!cancelled) {
        setLiveKitModule(module);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeCallId, liveKitModule]);

  useEffect(() => {
    if (!activeCallId) return;
    return () => {
      if (useCallStore.getState().activeCall?.id === activeCallId) {
        void leaveActiveCall();
      }
    };
  }, [activeCallId]);

  const hasVoiceRoom = activeCall?.callType === 'AUDIO' && Boolean(livekit);
  const startVoiceAudioRouting = liveKitModule?.startVoiceAudioRouting;

  useEffect(() => {
    if (hasVoiceRoom) return startVoiceAudioRouting?.();
  }, [hasVoiceRoom, startVoiceAudioRouting]);

  const handleRetryConnection = useCallback(async () => {
    if (!activeCall || retrying) return;
    setRetrying(true);
    try {
      const response = await requestJoinToken(activeCall.id);
      if (!mountedRef.current || useCallStore.getState().activeCall?.id !== activeCall.id) return;
      reportedRoomErrorRef.current = false;
      setLiveKitCredentials(response.livekit);
      setConnectError(null);
      setRoomVersion((current) => current + 1);
    } catch (error) {
      reportHandledFailure('call', 'retryConnection', error);
    } finally {
      if (mountedRef.current) {
        setRetrying(false);
      }
    }
  }, [activeCall, retrying, setLiveKitCredentials]);

  const minimize = useCallback(() => {
    setMinimized(true);
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/messages');
  }, [setMinimized]);

  const restore = useCallback(() => {
    setMinimized(false);
    router.navigate('/(chat)/group-call');
  }, [setMinimized]);

  const handleFallbackBack = useCallback(() => {
    void leaveActiveCall();
  }, []);

  if (!activeCall) return null;

  if (!livekit) {
    return (
      <View style={[s.overlay, s.missing, { backgroundColor: colors.background }]}>
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
      <View style={[s.overlay, s.missing, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[s.missingTitle, { color: colors.text }]}>
          {t('call.preparing', { defaultValue: '正在准备通话组件...' })}
        </Text>
      </View>
    );
  }

  if (!liveKitModule) {
    return (
      <View style={[s.overlay, s.missing, { backgroundColor: colors.background }]}>
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
  const RoomAudioRenderer = liveKitModule.RoomAudioRenderer;
  const isVideoCall = activeCall.callType === 'VIDEO';

  return (
    <View pointerEvents={minimized ? 'box-none' : 'auto'} style={[
      s.overlay,
      !minimized && (isVideoCall ? [s.container, { backgroundColor: colors.background }] : s.voiceContainer),
    ]}>
      <LiveKitRoom
        key={roomVersion}
        serverUrl={livekit.url}
        token={livekit.token}
        connect
        audio
        video={activeCall.callType === 'VIDEO'}
        // review P2：订阅侧裁剪 —— adaptiveStream 让未渲染/不可见的视频轨
        // 自动暂停下行，dynacast 让发布端按需暂停无人看的层；渲染上限
        // MAX_VIDEO_TILES 是第二道闸。
        options={{ adaptiveStream: true, dynacast: true }}
        onConnected={callTelemetry.connected}
        onDisconnected={callTelemetry.disconnected}
        onError={(error) => {
          if (!reportedRoomErrorRef.current) {
            reportedRoomErrorRef.current = true;
            reportError(error, {
              operation: 'livekit',
              kind: 'roomConnection',
            });
          }
          devWarn('[call] LiveKit room error', error);
          setConnectError(
            t('call.connectionFailed', { defaultValue: '通话连接失败，请重试' }),
          );
        }}
      >
        {/* 必须在 Room 内：远端音轨的播放载体（web 是 <audio>，原生 no-op）。 */}
        <RoomAudioRenderer />
        <CallRoomContent
          liveKitModule={liveKitModule}
          callTelemetry={callTelemetry}
          minimized={minimized}
          onMinimize={minimize}
          onRestore={restore}
          onInvite={() => setInviteVisible(true)}
        />
      </LiveKitRoom>
      <CallInvitePicker visible={inviteVisible} call={activeCall} onClose={() => setInviteVisible(false)} onInvited={updateActiveCall} />
      {connectError && !minimized ? (
        <View style={[
          s.errorBar,
          !isVideoCall && [s.voiceErrorBar, { paddingBottom: insets.bottom + Spacing.md }],
        ]}>
          <Text style={[Typography.small, { color: isVideoCall ? colors.error : '#ff8187' }]}>
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

/** A room belongs to the app session so navigating away cannot stop its audio. */
export function ActiveCallHost() {
  const { t } = useTranslation();
  const activeCall = useCallStore((state) => state.activeCall);
  const incomingCall = useCallStore((state) => state.incomingCall);
  const minimized = useCallStore((state) => state.isMinimized);
  const previous = useRef<{ id: string; minimized: boolean } | null>(null);

  useEffect(() => {
    if (previous.current && !activeCall && previous.current.minimized) {
      showTopNotice({ title: t('chat.callRecord.ended') });
    }
    previous.current = activeCall && !incomingCall ? { id: activeCall.id, minimized } : null;
  }, [activeCall, incomingCall, minimized, t]);

  return activeCall && !incomingCall ? <ActiveCallSession key={activeCall.id} /> : null;
}

/** The route presents the globally hosted room. Back navigation minimizes it. */
export default function GroupCallScreen() {
  const { t } = useTranslation();
  const callId = useCallStore((state) => state.activeCall?.id);
  const setMinimized = useCallStore((state) => state.setMinimized);
  const focused = useIsFocused();
  const closed = useRef(false);

  useFocusEffect(useCallback(() => {
    setMinimized(false);
    return () => setMinimized(true);
  }, [setMinimized]));

  useEffect(() => {
    if (callId || !focused || closed.current) return;
    closed.current = true;
    showTopNotice({ title: t('chat.callRecord.ended') });
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/messages');
  }, [callId, focused, t]);

  return null;
}
