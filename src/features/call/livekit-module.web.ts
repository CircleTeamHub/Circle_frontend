import { createElement, type ComponentType, type CSSProperties, type PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { reportError } from '@/observability/sentry';

/**
 * LiveKit 模块的 Web 档：用 @livekit/components-react + 浏览器原生 WebRTC
 * 适配与原生档（livekit-module.ts）完全相同的接口 —— GroupCallScreen 对
 * 平台差异无感。@livekit/react-native 一个字节都不会进 web bundle，反之
 * components-react 也不进原生包（平台文件对隔离，见原生档头注释）。
 * ⚠️ 两档导出面必须一致（Metro 按平台择档，tsc 两份都查）。
 */

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
  useTracks: (sources: string[]) => LiveKitTrackReference[];
  useParticipants: () => {
    identity: string;
    name?: string;
  }[];
  useRoomContext: () => {
    disconnect: () => Promise<void>;
  };
  /** 见原生档注释：web 上少了它远端就是哑的。 */
  RoomAudioRenderer: ComponentType<Record<string, never>>;
  registerGlobals?: () => void;
};

let cachedLiveKitModule: LiveKitModule | null | undefined;
let liveKitModulePromise: Promise<LiveKitModule | null> | null = null;

/** 浏览器侧的"WebRTC 在场"判据（SSG 的 Node 环境里恒 false → null）。 */
function isWebRtcAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export function getInitialLiveKitModule(): LiveKitModule | null | undefined {
  return isWebRtcAvailable() ? cachedLiveKitModule : null;
}

type ComponentsReactModule = typeof import('@livekit/components-react');

function adaptComponentsReact(m: ComponentsReactModule): LiveKitModule {
  const VideoTrack: LiveKitModule['VideoTrack'] = function WebVideoTrack({
    trackRef,
    style,
    objectFit,
    mirror,
  }) {
    if (!trackRef) return null;
    // RN 的样式数组要先摊平；ViewStyle 的 camelCase 键绝大多数就是合法 CSS。
    // <video> 的适配（铺满 + objectFit + 镜像）叠在调用方样式之上。
    const flattened = (StyleSheet.flatten(style) ?? {}) as CSSProperties;
    const css: CSSProperties = {
      width: '100%',
      height: '100%',
      ...flattened,
      objectFit: objectFit ?? 'cover',
      transform: mirror ? 'scaleX(-1)' : undefined,
    };
    return createElement(m.VideoTrack, {
      trackRef: trackRef as never,
      style: css,
    });
  };

  // 包装函数都以 use 开头：它们就是 hook（直调 components-react 的同名 hook）。
  function useConnectionStateWeb(): string {
    return String(m.useConnectionState());
  }
  function useTracksWeb(sources: string[]): LiveKitTrackReference[] {
    return m.useTracks(sources as never) as unknown as LiveKitTrackReference[];
  }

  return {
    LiveKitRoom: m.LiveKitRoom as unknown as LiveKitModule['LiveKitRoom'],
    VideoTrack,
    useConnectionState: useConnectionStateWeb,
    useLocalParticipant:
      m.useLocalParticipant as unknown as LiveKitModule['useLocalParticipant'],
    useTracks: useTracksWeb,
    useParticipants:
      m.useParticipants as unknown as LiveKitModule['useParticipants'],
    useRoomContext:
      m.useRoomContext as unknown as LiveKitModule['useRoomContext'],
    // LiveKitRoom 连接 + 发布本地轨，但不创建播放远端的 <audio>：
    // 没有这个 renderer，网页端通话看着已连接，每个远端参与者都是静音的。
    RoomAudioRenderer:
      m.RoomAudioRenderer as unknown as LiveKitModule['RoomAudioRenderer'],
    // 浏览器 WebRTC 是原生 API，无需注册 globals。
    registerGlobals: undefined,
  };
}

export function loadLiveKitModule(): Promise<LiveKitModule | null> {
  if (!isWebRtcAvailable()) {
    return Promise.resolve(null);
  }
  if (cachedLiveKitModule !== undefined) {
    return Promise.resolve(cachedLiveKitModule);
  }
  if (liveKitModulePromise) {
    return liveKitModulePromise;
  }

  liveKitModulePromise = import('@livekit/components-react')
    .then((module) => {
      cachedLiveKitModule = adaptComponentsReact(module);
      return cachedLiveKitModule;
    })
    .catch((error) => {
      cachedLiveKitModule = null;
      reportError(new Error('LiveKit web module failed to load'), {
        operation: 'livekit',
        kind: 'moduleLoad',
      });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[call] LiveKit web module unavailable', error);
      }
      return cachedLiveKitModule;
    });

  return liveKitModulePromise;
}
