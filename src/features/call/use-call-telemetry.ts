import { useEffect, useState } from 'react';
import { createCallTelemetry, type CallTelemetry } from './call-telemetry';

/**
 * 每个 LiveKitRoom 实例一份通话遥测。roomKey 变了（重连按钮换了新房间）就换一份
 * 新的、旧的收尾 —— 旧房间迟到的事件只会落到它自己那份上，不会污染新房间。
 */
export function useCallTelemetry(roomKey: number): CallTelemetry {
  const [entry, setEntry] = useState(() => ({ roomKey, telemetry: createCallTelemetry() }));
  const current =
    entry.roomKey === roomKey ? entry : { roomKey, telemetry: createCallTelemetry() };
  if (current !== entry) setEntry(current);
  const { telemetry } = current;
  useEffect(() => () => telemetry.dispose(), [telemetry]);
  return telemetry;
}

/** livekit-client Room 的事件订阅面（只声明用到的事件）。 */
export interface CallRoomEvents {
  on?: (event: 'connectionQualityChanged', listener: CallQualityListener) => unknown;
  off?: (event: 'connectionQualityChanged', listener: CallQualityListener) => unknown;
}

type CallQualityListener = (quality: unknown, participant?: { isLocal?: boolean }) => void;

/** 在 LiveKitRoom 里面：把连接状态和本端连接质量喂给遥测。 */
export function useCallRoomTelemetry(
  room: CallRoomEvents,
  connectionState: string,
  telemetry: CallTelemetry,
): void {
  // 子组件的 effect 先于 LiveKitRoom 自己发起建连的 effect 执行：这里就是建连起点。
  useEffect(() => {
    telemetry.roomMounted();
  }, [telemetry]);

  useEffect(() => {
    telemetry.connectionStateChanged(connectionState);
  }, [connectionState, telemetry]);

  useEffect(() => {
    const onQuality: CallQualityListener = (quality, participant) => {
      if (participant?.isLocal) telemetry.qualityChanged(quality);
    };
    room.on?.('connectionQualityChanged', onQuality);
    return () => {
      room.off?.('connectionQualityChanged', onQuality);
    };
  }, [room, telemetry]);
}
