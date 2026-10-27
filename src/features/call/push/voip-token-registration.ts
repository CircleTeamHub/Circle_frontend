import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  registerPushToken,
  revokePushToken,
} from '@/services/api/notifications';
import {
  createPushRegistrationStore,
  createPushTokenRegistrationOrchestrator,
  generateRevocationSecret,
} from '@/features/notifications/services/push-token-registration';
import { reportNotificationFailure } from '@/features/notifications/utils/report-failure';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import { CALL_PUSH_VERSION, getCallPushModule } from './call-push-native';

const VOIP_REGISTRATION_KEY = 'circle-im-voip-push-registration';

/**
 * iOS 的 PushKit VoIP token 单独登记（provider=apns_voip）：极光 / Expo 的 token 管通知，
 * 这个只管来电。VoIP 推送不需要系统通知权限 —— 用户关了通知也照样能来电；登出、切账号、
 * 关掉推送时与普通 token 一样撤销。
 */
function createVoipPushTokenRegistrationOrchestrator() {
  const store = createPushRegistrationStore(VOIP_REGISTRATION_KEY);
  let environment: 'development' | 'production' = 'production';
  return createPushTokenRegistrationOrchestrator({
    platform: 'ios',
    provider: 'apns_voip',
    appVersion: Constants.expoConfig?.version ?? null,
    getProjectId: () => null,
    ...store,
    generateRevocationSecret,
    loadNotificationsModule: async () => null,
    requiresNotificationPermission: false,
    getToken: async () => {
      const voip = await getCallPushModule()?.getVoipToken();
      if (!voip) return '';
      environment = voip.environment;
      return voip.token;
    },
    getRegistrationExtras: () => ({
      callPushVersion: CALL_PUSH_VERSION,
      apnsEnvironment: environment,
    }),
    registerPushToken,
    revokePushToken,
    scheduleRetry: (callback, delayMs) => setTimeout(callback, delayMs),
    cancelRetry: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: Date.now,
    reportFailure: reportNotificationFailure,
    reportDiagnostic: logClientDiagnostic,
  });
}

type VoipOrchestrator = ReturnType<typeof createVoipPushTokenRegistrationOrchestrator>;

let shared: VoipOrchestrator | null = null;

/** 只有 iOS 且打过新原生包才有；其余平台返回 null。 */
export function getVoipPushTokenRegistrationOrchestrator(): VoipOrchestrator | null {
  if (Platform.OS !== 'ios' || !getCallPushModule()) return null;
  shared ??= createVoipPushTokenRegistrationOrchestrator();
  return shared;
}
