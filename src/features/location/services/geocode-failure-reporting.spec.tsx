import { reportHandledFailure } from '@/observability/report-failure';
import { reportGeocodeFailure } from './geocode-failure-reporting';

jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

const mockReport = jest.mocked(reportHandledFailure);

function codedError(code: string): Error {
  return Object.assign(new Error(`coded ${code}`), { code });
}

beforeEach(() => mockReport.mockClear());

describe('reverse-geocode failure reporting', () => {
  it('maps each stage onto a literal Sentry tag', () => {
    const native = new Error('geocoder crashed');
    const config = new TypeError('Invalid URL');
    const lookup = new Error('reverse geocode failed: 503');

    reportGeocodeFailure('nativeResolver', native);
    reportGeocodeFailure('geocoderConfig', config);
    reportGeocodeFailure('lookup', lookup);

    expect(mockReport.mock.calls).toEqual([
      ['location', 'nativeReverseGeocode', native],
      ['location', 'geocoderConfig', config],
      ['location', 'reverseGeocode', lookup],
    ]);
  });

  it('does not report a platform that simply lacks a device geocoder', () => {
    // web 端 expo-location 抛 UnavailabilityError(ERR_UNAVAILABLE);国内无 GMS 的
    // Android 机抛 NoGeocodeException(ERR_NO_GEOCODE)。这是能力缺失,不是故障,
    // 报上去每次打开位置消息都是一条噪音。
    reportGeocodeFailure('nativeResolver', codedError('ERR_UNAVAILABLE'));
    reportGeocodeFailure('nativeResolver', codedError('ERR_NO_GEOCODE'));
    expect(mockReport).not.toHaveBeenCalled();
  });
});
