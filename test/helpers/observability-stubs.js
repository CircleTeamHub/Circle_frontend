/**
 * 观测层桩：源码里的 catch 站点统一走 `@/observability/report-failure`（dev 打印 +
 * 面包屑 + 去重后进 Sentry）与 `@/utils/dev-log`。node --test 的 VM 装载器解析不了
 * `@/` 别名、也不该在测试里碰原生 Sentry，所以给这两个模块一份无副作用的默认替身。
 *
 * withObservabilityStubs 包住测试自己的 require 实现：测试若显式提供了这两个模块
 * （比如要断言 reportHandledFailure 被调过），显式提供的导出优先；提供 `{}` 或
 * 直接抛「unexpected import」时回落到这里的默认桩。
 */
function makeObservabilityStubs() {
  return {
    '@/observability/report-failure': {
      reportHandledFailure() {},
      isExpectedFailure: () => false,
      resetHandledFailureTelemetry() {},
    },
    '@/utils/dev-log': {
      devWarn() {},
    },
    '@/utils/client-diagnostics': {
      logClientDiagnostic() {},
      diagnosticErrorMessage: (error) =>
        error instanceof Error ? error.message : String(error),
      readDiagnosticBreadcrumbs: () => [],
      resetDiagnosticBreadcrumbs() {},
    },
  };
}

const OBSERVABILITY_STUBS = makeObservabilityStubs();

function withObservabilityStubs(requireImpl) {
  return (request) => {
    if (!Object.prototype.hasOwnProperty.call(OBSERVABILITY_STUBS, request)) {
      return requireImpl(request);
    }
    let provided;
    try {
      provided = requireImpl(request);
    } catch {
      provided = undefined;
    }
    return provided && typeof provided === 'object'
      ? { ...OBSERVABILITY_STUBS[request], ...provided }
      : OBSERVABILITY_STUBS[request];
  };
}

module.exports = { OBSERVABILITY_STUBS, makeObservabilityStubs, withObservabilityStubs };
