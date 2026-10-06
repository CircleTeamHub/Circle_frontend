import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { VOICE_RECORDING_OPTIONS } from '@/features/chat/utils/voice-recording-options';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import { Alert, Keyboard, LayoutAnimation, PanResponder } from 'react-native';
import { PANEL_LAYOUT_ANIM } from '@/features/chat/chat-detail/constants';
import { reportHandledFailure } from '@/observability/report-failure';
import { assertMyTempChatConversationOpen } from '@/services/api/temp-chat';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import {
  failMediaSend,
  finishMediaSend,
  sendVoiceMessage,
  startMediaSend,
} from '@/chat-core/client';
import { logChatSendFailure } from '@/features/chat/chat-detail/helpers';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { type TFunction } from 'i18next';

export interface VoiceRecordingParams {
  t: TFunction<"translation", undefined>;
  inFlightRef: RefObject<boolean>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  setAttachmentOpen: Dispatch<SetStateAction<boolean>>;
  setEmojiOpen: Dispatch<SetStateAction<boolean>>;
  windowWidth: number;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  isTempChat: boolean;
  composerLocked: boolean;
  conversationType: "group" | "single";
  isGroupChat: boolean;
  isPreviewMode: boolean;
}

/**
 * 聊天页的语音消息:语音输入模式切换、按住录音/上滑取消、录完上传发送(与长按重发共用)。
 * 录音状态只在这里持有;界面需要的状态与手势 handler 通过返回值给出。
 */
export function useVoiceRecording({
  t,
  inFlightRef,
  setSendError,
  setAttachmentOpen,
  setEmojiOpen,
  windowWidth,
  mountedRef,
  sourceID,
  conversationID,
  isTempChat,
  composerLocked,
  conversationType,
  isGroupChat,
  isPreviewMode,
}: VoiceRecordingParams) {
  const voiceRecorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const [voiceRecordingStartedAt, setVoiceRecordingStartedAt] = useState<number | null>(null);
  const [voiceActionBusy, setVoiceActionBusy] = useState(false);
  // 语音输入模式：点话筒后输入框变「按住说话」；按住时滑到左侧取消、松手发送。
  const [voiceInputMode, setVoiceInputMode] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  // PanResponder 闭包只在创建时捕获一次，用 ref 把最新状态/回调透进去，避免读到旧值。
  const voicePressActiveRef = useRef(false);
  const voiceStartInProgressRef = useRef(false);
  const voiceRecordSessionRef = useRef(0);
  const recordingAudioModeSessionRef = useRef(0);
  const cancelArmedRef = useRef(false);
  // 录音状态的纯 JS 快照：卸载 cleanup 里不能调 recorder 的 native getStatus()，
  // 此时 expo-audio 可能已释放其 native shared object（会抛 NativeSharedObjectNotFoundException）。
  const isRecordingRef = useRef(false);
  const recordingAudioModeEnabledRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = voiceRecordingStartedAt != null;
  }, [voiceRecordingStartedAt]);
  const restoreRecordingAudioMode = useCallback(() => {
    if (recordingAudioModeEnabledRef.current) {
      recordingAudioModeEnabledRef.current = false;
      recordingAudioModeSessionRef.current = 0;
      setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  }, []);
  // 录音状态完全由 JS 侧的 voiceRecordingStartedAt 决定：录音是纯按住/松手驱动的
  // （没有配 maxDuration，不存在原生自动停止），所以不需要轮询 native 来发现状态变化。
  const isVoiceRecording = voiceRecordingStartedAt != null;
  const voiceElapsedSeconds = useElapsedSeconds(voiceRecordingStartedAt);

  // 切换「语音输入模式」：文本框 ↔ 按住说话。退出时若在录音则一并取消。
  const toggleVoiceInputMode = useCallback(() => {
    if (isPreviewMode || composerLocked) return;
    Keyboard.dismiss();
    LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
    setAttachmentOpen(false);
    setEmojiOpen(false);
    setVoiceInputMode((prev) => !prev);
  }, [composerLocked, isPreviewMode, setAttachmentOpen, setEmojiOpen]);

  // 按住开始录音。权限/音频模式准备好后 record()，失败时复位状态。
  const startHoldRecording = useCallback(async () => {
    if (!sourceID || isPreviewMode || composerLocked || voiceActionBusy) return;
    if (inFlightRef.current || voiceStartInProgressRef.current) return;
    voicePressActiveRef.current = true;
    voiceStartInProgressRef.current = true;
    const recordSession = ++voiceRecordSessionRef.current;
    setSendError(null);
    cancelArmedRef.current = false;
    setCancelArmed(false);
    setVoiceActionBusy(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissions.insufficientTitle'), t('permissions.microphone'));
        voicePressActiveRef.current = false;
        voiceRecordSessionRef.current += 1;
        return;
      }
      if (!voicePressActiveRef.current || recordSession !== voiceRecordSessionRef.current) {
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recordingAudioModeEnabledRef.current = true;
      recordingAudioModeSessionRef.current = recordSession;
      if (!voicePressActiveRef.current || recordSession !== voiceRecordSessionRef.current) {
        restoreRecordingAudioMode();
        return;
      }
      const status = voiceRecorder.getStatus();
      if (!status.canRecord) {
        await voiceRecorder.prepareToRecordAsync();
      }
      if (!voicePressActiveRef.current || recordSession !== voiceRecordSessionRef.current) {
        if (recordingAudioModeSessionRef.current === recordSession) {
          restoreRecordingAudioMode();
        }
        return;
      }
      voiceRecorder.record();
      setVoiceRecordingStartedAt(Date.now());
      inFlightRef.current = true;
    } catch (error) {
      reportHandledFailure('chatDetail', 'voiceRecord', error);
      inFlightRef.current = false;
      if (mountedRef.current) {
        setVoiceRecordingStartedAt(null);
        setSendError(
          t('chat.detail.recordStartFailed', {
            defaultValue: '录音启动失败，请重试',
          }),
        );
      }
      if (recordingAudioModeSessionRef.current === recordSession) {
        restoreRecordingAudioMode();
      }
    } finally {
      if (voiceRecordSessionRef.current === recordSession || !voicePressActiveRef.current) {
        voiceStartInProgressRef.current = false;
      }
      if (mountedRef.current) setVoiceActionBusy(false);
    }
  }, [
    composerLocked,
    isPreviewMode,
    restoreRecordingAudioMode,
    sourceID,
    t,
    voiceActionBusy,
    voiceRecorder,
    inFlightRef,
    mountedRef,
    setSendError,
  ]);

  // 松手结束录音。cancel=true 丢弃；否则发送。录音过短（<800ms）按误触丢弃。
  /**
   * 录音文件的「上传 + 发送」。首发和长按重发共用 —— 重发必须带上同一个
   * deliveryId,否则会在时间线里多出一条,而不是把那个红气泡换掉。
   */
  const uploadAndSendVoice = useCallback(
    async (soundPath: string, duration: number, deliveryId: string) => {
      try {
        if (isTempChat) {
          await assertMyTempChatConversationOpen(conversationID);
        }
        // 自研栈:录音文件先经 presign 上传,消息体只带 object key(读时签 URL)。
        const voiceFilename = soundPath.split('/').pop() || 'voice.m4a';
        const voiceContentType =
          resolveUploadContentType({ fileName: voiceFilename }) ?? 'audio/mp4';
        const presign = await requestUploadPresign({
          filename: sanitizeUploadFilename(voiceFilename),
          contentType: voiceContentType,
          folder: 'chat',
          fileUri: soundPath,
        });
        await uploadLocalFileToPresignedUrl(
          presign.uploadUrl,
          voiceContentType,
          soundPath,
          presign.requiredHeaders,
        );
        await sendVoiceMessage({
          conversationId: conversationID,
          key: presign.key,
          duration,
          localUri: soundPath,
          deliveryId,
        });
        finishMediaSend(deliveryId);
      } catch (error) {
        logChatSendFailure(error, {
          kind: 'voice',
          sessionType: conversationType,
          isGroupChat,
        });
        // 气泡标红留在原地(长按可重发),而不是让那段录音凭空消失。
        failMediaSend(conversationID, deliveryId);
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.voiceSendFailed', {
                defaultValue: '语音发送失败，请重试',
              }),
            ),
          );
        }
      }
    },
    [conversationID, conversationType, isGroupChat, isTempChat, t, mountedRef, setSendError],
  );

  const finishHoldRecording = useCallback(
    async (cancel: boolean) => {
      // 还没真正开始录音（极快松手 / 权限未过）→ 直接复位，避免空 stop。
      voicePressActiveRef.current = false;
      voiceRecordSessionRef.current += 1;
      if (!isRecordingRef.current && voiceRecordingStartedAt == null) {
          if (mountedRef.current) setVoiceActionBusy(false);
        return;
      }
      setVoiceActionBusy(true);
      try {
        const statusBeforeStop = voiceRecorder.getStatus();
        const soundPath = voiceRecorder.uri ?? statusBeforeStop.url;
        await voiceRecorder.stop();
        const elapsedMs =
          statusBeforeStop.durationMillis ||
          (voiceRecordingStartedAt ? Date.now() - voiceRecordingStartedAt : 0);
        const duration = Math.max(1, Math.round(elapsedMs / 1000));
        setVoiceRecordingStartedAt(null);

        if (cancel || elapsedMs < 800) return; // 取消 / 误触：丢弃不发
        if (!soundPath) throw new Error('录音文件生成失败');

        // 先上屏(sendStatus=1)、再后台上传:上传最长 60s,期间既不能让屏幕上
        // 什么都没有,也不能把输入栏锁死 —— 那就是「录完就消失、再按没反应」。
        const voiceFilename = soundPath.split('/').pop() || 'voice.m4a';
        const deliveryId = startMediaSend({
          conversationId: conversationID,
          type: 'voice',
          localContent: { duration, localUri: soundPath },
          retry: (id) => uploadAndSendVoice(soundPath, duration, id),
          source: {
            uri: soundPath,
            uploadName: voiceFilename,
            contentType:
              resolveUploadContentType({ fileName: voiceFilename }) ??
              'audio/mp4',
          },
        });
        void uploadAndSendVoice(soundPath, duration, deliveryId);
      } catch (error) {
        logChatSendFailure(error, {
          kind: 'voice',
          sessionType: conversationType,
          isGroupChat,
        });
        if (mountedRef.current) {
          setVoiceRecordingStartedAt(null);
          if (!cancel) {
            setSendError(
              getChatSendErrorMessage(
                error,
                t('chat.detail.voiceSendFailed', {
                  defaultValue: '语音发送失败，请重试',
                }),
              ),
            );
          }
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setVoiceActionBusy(false);
        restoreRecordingAudioMode();
        cancelArmedRef.current = false;
        if (mountedRef.current) setCancelArmed(false);
      }
    },
    [
      conversationID,
      conversationType,
      isGroupChat,
      restoreRecordingAudioMode,
      t,
      uploadAndSendVoice,
      voiceRecorder,
      voiceRecordingStartedAt,
      inFlightRef,
      mountedRef,
      setSendError,
    ],
  );

  // PanResponder 创建一次即可，用 ref 透传最新回调，避免闭包读旧值。
  const startHoldRef = useRef(startHoldRecording);
  const finishHoldRef = useRef(finishHoldRecording);
  const windowWidthRef = useRef(windowWidth);
  useEffect(() => {
    startHoldRef.current = startHoldRecording;
    finishHoldRef.current = finishHoldRecording;
    windowWidthRef.current = windowWidth;
  }, [startHoldRecording, finishHoldRecording, windowWidth]);

  const voicePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          void startHoldRef.current();
        },
        onPanResponderMove: (_evt, gesture) => {
          // 手指滑到屏幕左侧 40% 区域 → 进入取消态。
          const armed = gesture.moveX > 0 && gesture.moveX < windowWidthRef.current * 0.4;
          if (armed !== cancelArmedRef.current) {
            cancelArmedRef.current = armed;
            setCancelArmed(armed);
          }
        },
        onPanResponderRelease: () => {
          void finishHoldRef.current(cancelArmedRef.current);
        },
        onPanResponderTerminate: () => {
          // 手势被系统打断（来电等）→ 当作取消，丢弃录音。
          void finishHoldRef.current(true);
        },
      }),
    [],
  );

  useEffect(
    () => () => {
      // 用 JS 快照判断是否在录音，避免在已释放的 native 对象上调 getStatus()；
      // stop() 再用 try/catch + .catch 兜底（卸载时对象可能已被 hook 释放）。
      if (isRecordingRef.current) {
        try {
          void voiceRecorder.stop().catch(() => undefined);
        } catch {
          // native shared object 已释放，录音已随之结束，无需再 stop
        }
      }
      restoreRecordingAudioMode();
    },
    [restoreRecordingAudioMode, voiceRecorder],
  );

  return {
    voiceInputMode,
    cancelArmed,
    isVoiceRecording,
    voiceElapsedSeconds,
    toggleVoiceInputMode,
    uploadAndSendVoice,
    voicePanResponder,
  };
}
