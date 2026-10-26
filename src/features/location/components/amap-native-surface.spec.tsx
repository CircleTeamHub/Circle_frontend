import { reportHandledFailure } from '@/observability/report-failure';
import { configureAmapPrivacy, loadAmapModule } from './amap-native-surface';

jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

// 真模块会拉起本地存储(AsyncStorage 原生模块在 Jest 里不存在);这里只需要版本号。
jest.mock('@/features/location/services/amap-privacy-consent', () => ({
  AMAP_PRIVACY_CONSENT_VERSION: 'test-version',
}));

jest.mock('expo-gaode-map', () => ({
  MapView: () => null,
  ExpoGaodeMapModule: {
    setPrivacyConfig: () => {
      throw new Error('native privacy handshake failed');
    },
    getPrivacyStatus: () => ({ isReady: false }),
  },
}));

const mockReport = jest.mocked(reportHandledFailure);

beforeEach(() => mockReport.mockClear());

describe('AMap native surface failure reporting', () => {
  it('reports a failed privacy handshake instead of silently falling back', () => {
    expect(configureAmapPrivacy()).toBe(false);
    expect(mockReport).toHaveBeenCalledWith(
      'location',
      'amapPrivacyConfig',
      expect.any(Error),
    );
  });

  it('treats a missing native module as expected when this build has no AMap key', () => {
    // Expo Go、未 prebuild、没配 key 的预发布包本来就没有这个原生模块,
    // 回落网页地图是设计行为;每次启动报一条只会是噪音。
    const loaded = loadAmapModule(() => {
      throw new Error('Cannot find native module ExpoGaodeMap');
    }, false);
    expect(loaded).toBeNull();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports a module that fails to load in a build configured for AMap', () => {
    const failure = new Error('Cannot find native module ExpoGaodeMap');
    const loaded = loadAmapModule(() => {
      throw failure;
    }, true);
    expect(loaded).toBeNull();
    expect(mockReport).toHaveBeenCalledWith('location', 'amapModuleLoad', failure);
  });

  it('reports an incompatible module shape in a build configured for AMap', () => {
    expect(loadAmapModule(() => ({ MapView: null }), true)).toBeNull();
    expect(mockReport).toHaveBeenCalledWith(
      'location',
      'amapModuleLoad',
      expect.objectContaining({ name: 'AmapModuleIncompatible' }),
    );
  });
});
