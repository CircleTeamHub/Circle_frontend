import type { ComponentType, PropsWithChildren } from 'react';
import { NativeModules } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { ensureLiveKitGlobals } from '@/utils/livekit-globals';
import { reportError } from '@/observability/sentry';

/**
 * LiveKit 模块的平台间接层（原生档）：动态 import @livekit/react-native，
 * 原生模块缺席（Expo Go / 未装 WebRTC）时整体降级为 null，通话屏据此显示
 * 「当前构建不支持」而不是崩溃。
 *
 * Web 档（livekit-module.web.tsx）改用 @livekit/components-react 适配同一
 * 接口 —— 用平台文件对而不是 Platform 分支，是因为 Metro 会把动态 import
 * 也静态打进 bundle：分支写法会让两个 SDK 互相进对方平台的包。
 * ⚠️ 两档导出面必须一致（Metro 按平台择档，tsc 两份都查）。
 */

// useTracks 返回的相机轨引用（只声明用到的字段）。直接透传给同模块的
// VideoTrack，运行时是 @livekit/components-react 的真实 TrackReference。
export type LiveKitTrackReference = {
  participant: { identity: string };
  publication?: { isMuted?: boolean };
};

export type LiveKitModule = {
  LiveKitRoom: ComponentType<
    PropsWithChildren<{
      serverUrl: string;
      token: string;
      connect?: boolean;
      audio?: boolean;
      video?: boolean;
      // livekit-client RoomOptions 的子集（只声明用到的字段）
      options?: { adaptiveStream?: boolean; dynacast?: boolean };
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
  /**
   * 远端音轨的播放载体。web 上 LiveKitRoom 只负责连接和发布，订阅到的远端
   * 音轨需要真实的 <audio> 元素才出声 —— 少了它，通话界面一切正常、双方
   * 却互相听不到。原生端音频由 SDK 的 AudioSession 直接走系统播放，
   * 这里是个 no-op，只为让两档导出面一致。
   */
  RoomAudioRenderer: ComponentType<Record<string, never>>;
  registerGlobals?: () => void;
};

/** 原生端不需要 DOM 音频载体（AudioSession 已经在放）。 */
function NativeRoomAudioRenderer(): null {
  return null;
}

let cachedLiveKitModule: LiveKitModule | null | undefined;
let liveKitModulePromise: Promise<LiveKitModule | null> | null = null;

/**
 * 通话屏挂载时的同步初值：原生 WebRTC 模块缺席 → 直接 null（不支持）；
 * 在场则给缓存（可能是 undefined → 屏幕的 effect 会触发异步装载）。
 */
export function getInitialLiveKitModule(): LiveKitModule | null | undefined {
  return NativeModules.WebRTCModule ? cachedLiveKitModule : null;
}

export function loadLiveKitModule(): Promise<LiveKitModule | null> {
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
      const native = module as unknown as Partial<LiveKitModule>;
      cachedLiveKitModule = {
        ...(native as LiveKitModule),
        RoomAudioRenderer:
          native.RoomAudioRenderer ?? NativeRoomAudioRenderer,
      };
      if (cachedLiveKitModule.registerGlobals) {
        ensureLiveKitGlobals(cachedLiveKitModule.registerGlobals);
      }
      return cachedLiveKitModule;
    })
    .catch((error) => {
      cachedLiveKitModule = null;
      reportError(new Error('LiveKit native module failed to load'), {
        operation: 'livekit',
        kind: 'moduleLoad',
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] LiveKit native module unavailable', error);
      }
      return cachedLiveKitModule;
    });

  return liveKitModulePromise;
}
