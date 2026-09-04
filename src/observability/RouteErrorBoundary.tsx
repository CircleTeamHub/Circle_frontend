import { useEffect } from 'react';
import {
  ErrorBoundary as ExpoRouterErrorBoundary,
  type ErrorBoundaryProps,
} from 'expo-router';
import { reportError } from './sentry';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

/**
 * 根路由 ErrorBoundary：expo-router 捕获到的渲染错误 → Sentry。
 *
 * 为什么必须有它：expo-router 的 <Try> 会在路由层 catch 掉渲染期抛错并渲染我们
 * 导出的 ErrorBoundary。被 boundary 接住的错误**不会**再到达全局 ErrorUtils
 * handler，Sentry 的自动崩溃捕获因此看不到它——用户对着一张错误页，我们这边一片
 * 安静。Sentry.wrap 也只加触摸/性能埋点，不含 boundary。
 *
 * 每个错误实例只报一次：expo-router 在 retry 之前不会换实例，但 StrictMode / 父级
 * 重渲染会让本组件多次挂载。
 */
const reportedErrors = new WeakSet<object>();

export function reportRouteRenderError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    if (reportedErrors.has(error)) return false;
    reportedErrors.add(error);
  }
  logClientDiagnostic('route.render.failed', { stage: 'errorBoundary' });
  reportError(error, {
    component: 'RouteErrorBoundary',
    operation: 'render',
    kind: 'route',
  });
  return true;
}

export function RouteErrorBoundary(props: ErrorBoundaryProps) {
  const { error } = props;
  useEffect(() => {
    reportRouteRenderError(error);
  }, [error]);
  return <ExpoRouterErrorBoundary {...props} />;
}
