import { Platform } from 'react-native';
import {
  iosCallMode,
  jpushCarriesCalls,
  nativeOwnsIncomingCallUi,
  usesVoipPush,
} from './call-push-native';

const mockConfig = { extra: {} as Record<string, unknown> };
const mockModule = { present: true };

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConfig;
    },
  },
}));
jest.mock('../../../../modules/call-push', () => ({
  __esModule: true,
  get default() {
    return mockModule.present ? {} : null;
  },
}));

const originalOS = Platform.OS;
function onPlatform(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

describe('call push build modes', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
    mockConfig.extra = {};
    mockModule.present = true;
  });

  test('defaults iOS to CallKit: VoIP push, system call UI, JPush does not carry calls', () => {
    onPlatform('ios');

    expect(iosCallMode()).toBe('callkit');
    expect(usesVoipPush()).toBe(true);
    expect(nativeOwnsIncomingCallUi()).toBe(true);
    // 两边都声明会响两次：CallKit 包的 iOS 极光 token 绝不承载来电。
    expect(jpushCarriesCalls()).toBe(false);
  });

  test('a China notification-mode build rings iOS through JPush and keeps the in-app sheet', () => {
    onPlatform('ios');
    mockConfig.extra = { iosCallMode: 'notification' };

    expect(iosCallMode()).toBe('notification');
    expect(usesVoipPush()).toBe(false);
    expect(nativeOwnsIncomingCallUi()).toBe(false);
    expect(jpushCarriesCalls()).toBe(true);
  });

  test('Android always rings through JPush once the native module is there', () => {
    onPlatform('android');

    expect(jpushCarriesCalls()).toBe(true);
    expect(usesVoipPush()).toBe(false);
    expect(nativeOwnsIncomingCallUi()).toBe(false);
  });

  test('installs without the native module declare nothing and keep today’s behaviour', () => {
    mockModule.present = false;
    for (const os of ['ios', 'android']) {
      onPlatform(os);
      expect(jpushCarriesCalls()).toBe(false);
      expect(usesVoipPush()).toBe(false);
      expect(nativeOwnsIncomingCallUi()).toBe(false);
    }
  });
});
