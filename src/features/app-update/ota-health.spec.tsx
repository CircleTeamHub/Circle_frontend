import { reportHandledFailure } from '@/observability/report-failure';
import {
  resetOtaHealthReportingForTests,
  startOtaHealthReporting,
  stopAutomaticOtaFailureWatch,
  type OtaHealthDependencies,
  type OtaStateContext,
} from './ota-health';

jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

const mockReport = jest.mocked(reportHandledFailure);

function harness(overrides: Partial<OtaHealthDependencies> = {}) {
  const listeners = new Set<(event: { context: OtaStateContext }) => void>();
  const removals: number[] = [];
  let latest: OtaStateContext = {};
  const dependencies: OtaHealthDependencies = {
    isEnabled: true,
    isDevelopment: false,
    isEmergencyLaunch: false,
    getLatestContext: () => latest,
    addStateChangeListener: (listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          removals.push(1);
          listeners.delete(listener);
        },
      };
    },
    ...overrides,
  };
  return {
    dependencies,
    listeners,
    removals,
    setInitialContext: (context: OtaStateContext) => {
      latest = context;
    },
    emit: (context: OtaStateContext) => {
      latest = context;
      for (const listener of [...listeners]) listener({ context });
    },
  };
}

beforeEach(() => {
  mockReport.mockClear();
  resetOtaHealthReportingForTests();
});

describe('OTA health reporting', () => {
  it('reports an emergency launch without the native reason text', () => {
    const { dependencies } = harness({ isEmergencyLaunch: true });

    startOtaHealthReporting(dependencies);

    expect(mockReport).toHaveBeenCalledTimes(1);
    const [operation, kind, error] = mockReport.mock.calls[0];
    expect(operation).toBe('otaUpdate');
    expect(kind).toBe('emergencyLaunch');
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('OtaEmergencyLaunch');
  });

  it('stays silent in development and when OTA is disabled', () => {
    for (const overrides of [{ isDevelopment: true }, { isEnabled: false }]) {
      resetOtaHealthReportingForTests();
      const { dependencies, listeners, setInitialContext } = harness({
        ...overrides,
        isEmergencyLaunch: true,
      });
      setInitialContext({ checkError: new Error('offline') });

      startOtaHealthReporting(dependencies);

      expect(listeners.size).toBe(0);
    }
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports a startup check failure that happened before JS subscribed', () => {
    const { dependencies, setInitialContext } = harness();
    const checkError = new Error('manifest request failed');
    setInitialContext({ checkError });

    startOtaHealthReporting(dependencies);

    expect(mockReport).toHaveBeenCalledWith('otaUpdate', 'autoCheck', checkError);
  });

  it('reports the automatic check and download failures once each', () => {
    const { dependencies, emit, listeners } = harness();
    startOtaHealthReporting(dependencies);
    expect(mockReport).not.toHaveBeenCalled();

    const checkError = new Error('check failed');
    emit({ checkError });
    emit({ checkError: new Error('check failed again') });
    const downloadError = new Error('asset download failed');
    emit({ checkError, downloadError });

    expect(mockReport.mock.calls).toEqual([
      ['otaUpdate', 'autoCheck', checkError],
      ['otaUpdate', 'autoDownload', downloadError],
    ]);
    // 两类都报过了,自动检查这次启动不会再有新信号,监听可以撤掉。
    expect(listeners.size).toBe(0);
  });

  it('stops watching once a manual check takes over the state machine', () => {
    const { dependencies, emit, listeners, removals } = harness();
    startOtaHealthReporting(dependencies);

    stopAutomaticOtaFailureWatch();
    emit({ checkError: new Error('manual check failed') });

    expect(mockReport).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(removals).toHaveLength(1);
  });

  it('starts at most once per JS runtime', () => {
    const { dependencies, listeners } = harness({ isEmergencyLaunch: true });

    startOtaHealthReporting(dependencies);
    startOtaHealthReporting(dependencies);

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
  });

  it('never lets an expo-updates failure escape into startup', () => {
    const { dependencies } = harness({
      addStateChangeListener: () => {
        throw new Error('native module missing');
      },
    });

    expect(() => startOtaHealthReporting(dependencies)).not.toThrow();
  });
});
