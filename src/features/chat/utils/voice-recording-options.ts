import { AudioQuality, IOSOutputFormat, type RecordingOptions } from 'expo-audio';

/**
 * 语音消息的录音参数:两端统一 AAC 单声道、m4a 容器(上传标 audio/mp4)。
 *
 * 原来用 RecordingPresets.LOW_QUALITY。安卓那一档是 3gp 容器里的 AMR-NB,上传时却标成
 * audio/mp4 —— iPhone 解不了 AMR,安卓发的语音在 iPhone 上放不出来;iOS 那一档是
 * 44.1kHz 双声道,对语音纯属浪费。32kbps 单声道 AAC 听人声足够,一分钟约 240KB。
 * 采样率用 44.1kHz:两端编码器都一定支持,低采样率在部分安卓机上的 AAC 编码器里不保证。
 */
export const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 32000,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};
