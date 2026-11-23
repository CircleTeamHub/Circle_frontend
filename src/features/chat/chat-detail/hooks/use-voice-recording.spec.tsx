import { act, renderHook } from '@testing-library/react-native';
import { PanResponder } from 'react-native';
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { reportHandledFailure } from '@/observability/report-failure';
import { VOICE_RECORDING_OPTIONS } from '@/features/chat/utils/voice-recording-options';
import { useVoiceRecording, type VoiceRecordingParams } from './use-voice-recording';

const mockRecorder = {
  getStatus: jest.fn(),
  prepareToRecordAsync: jest.fn(),
  record: jest.fn(),
  stop: jest.fn(),
  uri: 'file:///private/recording.m4a',
};
jest.mock('expo-audio', () => ({
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => mockRecorder,
}));
jest.mock('@/features/chat/utils/voice-recording-options', () => ({ VOICE_RECORDING_OPTIONS: { extension: '.m4a' } }));
jest.mock('@/features/chat/utils/media-error-guard', () => ({ mediaErrorGuard: () => () => true }));
jest.mock('@/hooks/use-elapsed-seconds', () => ({ useElapsedSeconds: () => 0 }));
jest.mock('@/features/chat/chat-detail/constants', () => ({ PANEL_LAYOUT_ANIM: {} }));
jest.mock('@/services/api/temp-chat', () => ({}));
jest.mock('@/services/api/upload', () => ({}));
jest.mock('@/chat-core/client', () => ({}));
jest.mock('@/features/chat/chat-detail/helpers', () => ({ logChatSendFailure: jest.fn() }));
jest.mock('@/chat-core/send-errors', () => ({ getChatSendErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

let params: VoiceRecordingParams;
let gesture: Parameters<typeof PanResponder.create>[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorder.getStatus.mockReturnValue({ canRecord: true, durationMillis: 1500 });
  mockRecorder.stop.mockReset().mockResolvedValue(undefined);
  jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue({ granted: true } as never);
  jest.mocked(setAudioModeAsync).mockReset().mockResolvedValue(undefined);
  jest.spyOn(PanResponder, 'create').mockImplementation((handlers) => {
    gesture = handlers;
    return { panHandlers: {} };
  });
  params = {
    t: ((key: string) => key) as VoiceRecordingParams['t'],
    inFlightRef: { current: false }, setSendError: jest.fn(),
    setAttachmentOpen: jest.fn(), setEmojiOpen: jest.fn(), windowWidth: 390,
    mountedRef: { current: true }, sourceID: 'peer', conversationID: 'conversation',
    isTempChat: false, composerLocked: false, conversationType: 'single',
    isGroupChat: false, isPreviewMode: false,
  };
});

afterEach(() => jest.restoreAllMocks());

async function startRecording() {
  await act(async () => { gesture.onPanResponderGrant?.({} as never, {} as never); });
}

test('prepares every recording with the voice options so iOS rebuilds the recording file', async () => {
  // iOS 的 prepareToRecordAsync() 不带参数时复用构造时的那个文件路径:目录被「清理缓存」
  // 删掉后照样返回成功却不建文件,松手后找不到录音、语音立刻失败。带参数才会重建目录与新文件。
  mockRecorder.getStatus.mockReturnValue({ canRecord: false, durationMillis: 0 });
  renderHook(() => useVoiceRecording(params));

  await startRecording();

  expect(mockRecorder.prepareToRecordAsync).toHaveBeenCalledWith(VOICE_RECORDING_OPTIONS);
  expect(mockRecorder.record).toHaveBeenCalledTimes(1);
});

test('reports a live recorder stop failure and restores the composer state', async () => {
  const error = new Error('native stop failed');
  mockRecorder.stop.mockRejectedValueOnce(error);
  const { result } = renderHook(() => useVoiceRecording(params));
  await startRecording();
  expect(result.current.isVoiceRecording).toBe(true);

  await act(async () => { gesture.onPanResponderRelease?.({} as never, {} as never); });

  expect(reportHandledFailure).toHaveBeenCalledWith('chatDetail', 'voiceRecordStop', error);
  expect(result.current.isVoiceRecording).toBe(false);
  expect(params.inFlightRef.current).toBe(false);
  expect(params.setSendError).toHaveBeenLastCalledWith('chat.detail.voiceSendFailed');
});

test('reports audio mode restoration failure even after a normal recording cancellation', async () => {
  const error = new Error('native audio mode failed');
  jest.mocked(setAudioModeAsync).mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
  const { result } = renderHook(() => useVoiceRecording(params));
  await startRecording();

  await act(async () => { gesture.onPanResponderTerminate?.({} as never, {} as never); });

  expect(reportHandledFailure).toHaveBeenCalledWith('chatDetail', 'voiceAudioModeRestore', error);
  expect(reportHandledFailure).toHaveBeenCalledTimes(1);
  expect(result.current.isVoiceRecording).toBe(false);
});

test('normal recording cancellation does not report a failure', async () => {
  renderHook(() => useVoiceRecording(params));
  await startRecording();
  await act(async () => { gesture.onPanResponderTerminate?.({} as never, {} as never); });
  expect(reportHandledFailure).not.toHaveBeenCalled();
});
