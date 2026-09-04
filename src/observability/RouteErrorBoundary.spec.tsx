import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { RouteErrorBoundary, reportRouteRenderError } from './RouteErrorBoundary';
import { reportError } from './sentry';

jest.mock('expo-router', () => ({
  ErrorBoundary: ({ error }: { error: Error }) => {
    const { Text: RNText } = jest.requireActual('react-native');
    return <RNText testID="fallback">{error.message}</RNText>;
  },
}));

jest.mock('./sentry', () => ({
  reportError: jest.fn(),
}));

jest.mock('@/utils/client-diagnostics', () => ({
  logClientDiagnostic: jest.fn(),
}));

const mockReportError = jest.mocked(reportError);

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    mockReportError.mockClear();
  });

  it('renders the expo-router fallback and reports the render error to Sentry once', () => {
    const error = new Error('render exploded');
    const retry = jest.fn(async () => {});

    const { getByTestId, rerender } = render(
      <RouteErrorBoundary error={error} retry={retry} />,
    );

    expect(getByTestId('fallback')).toHaveTextContent('render exploded');
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
