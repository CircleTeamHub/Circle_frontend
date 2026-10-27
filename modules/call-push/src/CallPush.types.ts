/** 原生层排队给 JS 的事件（JS 收到 onCallEventsAvailable 后用 consumeEvents 一次取走）。 */
export type CallPushNativeEvent =
  /** iOS：PushKit token 变了（新发 / 作废），JS 重新登记。 */
  | { type: 'voipToken' }
  /** 原生层已经开始为这通电话响铃（推送来的，或 JS 交给它的）。 */
  | { type: 'incoming'; callId: string }
  /** 用户在系统来电界面 / 全屏通知上点了接听：JS 去 accept 并入会。 */
  | { type: 'answer'; callId: string }
  /**
   * 用户拒接。declinedByNative = 原生层已凭推送里的单通令牌调过 /push-decline；
   * 否则（JS 交给原生层的来电没有令牌）由 JS 调 reject。
   */
  | { type: 'decline'; callId: string; declinedByNative: boolean }
  /** iOS：接通后在系统通话界面上挂断。 */
  | { type: 'hangup'; callId: string }
  /** 原生层自己收掉了振铃：到期、系统重置、被撤销推送收掉。 */
  | { type: 'end'; callId: string; reason: string };

export type VoipPushToken = {
  token: string;
  environment: 'development' | 'production';
};

/** JS 已知（WS 收到）的来电交给原生层响铃时的参数。 */
export type NativeIncomingCall = {
  callId: string;
  callerName: string;
  hasVideo: boolean;
  isGroup: boolean;
  expiresAt: string;
};

/**
 * 交给原生层收掉振铃的原因；iOS 映射成 CXCallEndedReason。
 * answered = 在应用内接通了：只停振铃（安卓收通知），通话本身继续 —— iOS 上什么都不做。
 */
export type NativeCallEndReason =
  | 'answered'
  | 'ended'
  | 'canceled'
  | 'missed'
  | 'failed'
  | 'answered_elsewhere'
  | 'declined_elsewhere';

export interface CallPushNativeModule {
  /** 原生层直接调 /push-decline 用的 API 根地址（与 JS 的 API_URL 同一个）。 */
  configure(apiBaseUrl: string): Promise<void>;
  consumeEvents(): Promise<CallPushNativeEvent[]>;
  /** iOS：PushKit 的 VoIP token；安卓恒为 null。 */
  getVoipToken(): Promise<VoipPushToken | null>;
  /** 让原生层为一通 JS 已知的来电响铃（iOS 报 CallKit，安卓发全屏来电通知）。 */
  showIncomingCall(call: NativeIncomingCall): Promise<void>;
  /** 收掉这通电话的原生振铃 / 系统通话界面；不认识的 callId 什么都不做。 */
  endCall(callId: string, reason: NativeCallEndReason): Promise<void>;
  /** 安卓 14+：系统是否允许全屏来电（被收回时只能横幅提醒）。iOS 恒为 true。 */
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): Promise<void>;
  addListener(
    eventName: 'onCallEventsAvailable',
    listener: () => void,
  ): { remove(): void };
}
