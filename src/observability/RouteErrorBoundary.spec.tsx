import { Platform, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { RouteErrorBoundary, reportRouteRenderError } from './RouteErrorBoundary';
import { reportError } from './sentry';

jest.mock('./sentry', () => ({
  reportError: jest.fn(),
}));

jest.mock('@/utils/client-diagnostics', () => ({
  logClientDiagnostic: jest.fn(),
}));

const mockReportError = jest.mocked(reportError);

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (_key: string, options: { defaultValue: string }) => options.defaultValue },
}));

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    mockReportError.mockClear();
  });

  it('reloads a failed Web route chunk on explicit retry so React.lazy can recover', () => {
    const platform = Platform.OS;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const reload = jest.fn();
    Platform.OS = 'web';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload } } });
    try {
      const error = Object.assign(new Error('chunk request failed'), { name: 'AsyncRequireError' });
      const retry = jest.fn(async () => {});
      const view = render(<RouteErrorBoundary error={error} retry={retry} />);
      expect(reload).not.toHaveBeenCalled();
      fireEvent.press(view.getByTestId('router_error_retry'));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
    } finally {
      Platform.OS = platform;
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('keeps the existing native retry for an async module failure', () => {
    const platform = Platform.OS;
    Platform.OS = 'ios';
    try {
      const error = Object.assign(new Error('module load failed'), { name: 'AsyncRequireError' });
      const retry = jest.fn(async () => {});
      const view = render(<RouteErrorBoundary error={error} retry={retry} />);
      fireEvent.press(view.getByTestId('router_error_retry'));
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = platform;
    }
  });

  it('hides raw render errors, allows retry and reports to Sentry once', () => {
    const error = new Error('render exploded');
    const retry = jest.fn(async () => {});

    const { getByTestId, queryByText, rerender } = render(
      <RouteErrorBoundary error={error} retry={retry} />,
    );

    expect(queryByText('render exploded')).toBeNull();
    fireEvent.press(getByTestId('router_error_retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError).toHaveBeenCalledWith(error, {
      component: 'RouteErrorBoundary',
      operation: 'render',
      kind: 'route',
    });

    // 父级重渲染 / StrictMode 重挂载不会把同一个错误报两次。
    rerender(<RouteErrorBoundary error={error} retry={retry} />);
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });

  it('reports a new error instance after retry produced a different failure', () => {
    const first = new Error('first');
    const second = new Error('second');

    expect(reportRouteRenderError(first)).toBe(true);
    expect(reportRouteRenderError(first)).toBe(false);
    expect(reportRouteRenderError(second)).toBe(true);
    expect(mockReportError).toHaveBeenCalledTimes(2);
  });

  it('still reports non-object throwables', () => {
    expect(reportRouteRenderError('a string was thrown')).toBe(true);
    expect(mockReportError).toHaveBeenCalledWith('a string was thrown', {
      component: 'RouteErrorBoundary',
      operation: 'render',
      kind: 'route',
    });
    // 未使用的 Text 导入只是让 jest-expo 的 RN mock 预热；无断言。
    expect(Text).toBeDefined();
  });
});
