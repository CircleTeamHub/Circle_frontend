/**
 * ota-health.ts — OTA（expo-updates）在启动阶段的失败上报。
 *
 * 之前这几类失败在生产上完全无声：
 * - isEmergencyLaunch：下载好的 OTA 包启动失败，expo-updates 回滚到了内置包。用户
 *   看到的是「更新又没了」，我们这边什么都看不到；
 * - 启动时的自动检查（checkAutomatically: ON_LOAD）/ 自动下载失败：只写进原生状态机
 *   的 checkError / downloadError，没有任何 JS 代码去读。
 *
 * 这里统一走 reportHandledFailure（面包屑 + 去重后进 Sentry），operation / kind
 * 是字面量。emergencyLaunchReason 与原生错误文本都不上报：iOS 上带含安装 UUID 的
 * 沙盒路径；reportError 本来也只发安全的固定消息。
 *
 * 状态机是手动检查（关于页「检查应用内容更新」）和自动检查共用的。手动检查自己会
 * 上报失败，开始前调 stopAutomaticOtaFailureWatch()，免得同一次失败再被这里记成
 * autoCheck。ON_LOAD 每次启动只自动检查一次，所以 check / download 各报一次就够。
 *
 * addUpdatesStateChangeListener / latestContext 是 expo-updates 的导出（useUpdates
 * 也基于它们）；不用 useUpdates 是因为它会随下载进度不停触发重渲染。
 */
import * as Updates from 'expo-updates';
import { reportHandledFailure } from '@/observability/report-failure';

export interface OtaStateContext {
  checkError?: Error;
  downloadError?: Error;
}

interface OtaStateSubscription {
  remove: () => void;
}

export interface OtaHealthDependencies {
  isEnabled: boolean;
  isDevelopment: boolean;
  isEmergencyLaunch: boolean;
  getLatestContext: () => OtaStateContext;
  addStateChangeListener: (
    listener: (event: { context: OtaStateContext }) => void,
  ) => OtaStateSubscription;
}

class OtaEmergencyLaunchError extends Error {
  constructor() {
    super('expo-updates fell back to the embedded bundle');
    this.name = 'OtaEmergencyLaunch';
  }
}

function defaultDependencies(): OtaHealthDependencies {
  return {
    isEnabled: Updates.isEnabled,
    isDevelopment: typeof __DEV__ !== 'undefined' && __DEV__,
    isEmergencyLaunch: Updates.isEmergencyLaunch,
    getLatestContext: () => Updates.latestContext,
    addStateChangeListener: Updates.addUpdatesStateChangeListener,
  };
}

let started = false;
let automaticWatch: OtaStateSubscription | null = null;

/** 每个 JS 运行时只生效一次；在 initSentry 之后调用。 */
export function startOtaHealthReporting(
  dependencies: OtaHealthDependencies = defaultDependencies(),
): void {
  if (started) return;
  started = true;
  try {
    if (!dependencies.isEnabled || dependencies.isDevelopment) return;
    if (dependencies.isEmergencyLaunch) {
      reportHandledFailure('otaUpdate', 'emergencyLaunch', new OtaEmergencyLaunchError());
    }

    let checkReported = false;
    let downloadReported = false;
    const inspect = (context: OtaStateContext) => {
      if (context.checkError && !checkReported) {
        checkReported = true;
        reportHandledFailure('otaUpdate', 'autoCheck', context.checkError);
      }
      if (context.downloadError && !downloadReported) {
        downloadReported = true;
        reportHandledFailure('otaUpdate', 'autoDownload', context.downloadError);
      }
      if (checkReported && downloadReported) stopAutomaticOtaFailureWatch();
    };

    automaticWatch = dependencies.addStateChangeListener((event) => {
      if (automaticWatch) inspect(event.context);
    });
    // JS 订阅之前原生那次检查可能已经失败了，初始状态里就带着错误。
    inspect(dependencies.getLatestContext());
  } catch {
    // 可观测性绝不能影响启动。
  }
}

/** 手动检查开始前调用：之后状态机里的错误属于那次手动检查，由调用方上报。 */
export function stopAutomaticOtaFailureWatch(): void {
  const watch = automaticWatch;
  automaticWatch = null;
  watch?.remove();
}

/** 测试隔离用。 */
export function resetOtaHealthReportingForTests(): void {
  stopAutomaticOtaFailureWatch();
  started = false;
}
