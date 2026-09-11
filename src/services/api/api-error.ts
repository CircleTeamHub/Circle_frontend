/**
 * 统一的 HTTP 失败载体。
 *
 * 单独成模块（而不是留在 client.ts）是为了让「只需要判别失败形状」的模块 ——
 * 比如 mutation-outcome —— 不必把整条 fetch/i18n/session 依赖链拖进来，
 * 测试也能直接装载真模块，而不是各自手抄一份判别逻辑。
 * client.ts 仍然原样 re-export 它，既有 `from '@/services/api/client'` 不变。
 */
export class ApiError extends Error {
  status: number;
  code?: number;
  data?: unknown;
  failureKind?: string;
  reportEndpoint?: string;
  reportMethod?: string;
  // 后端稳定错误码(如 AUTH_INVALID_CREDENTIALS);前端据此做 i18n 映射,缺失回落 message。
  errorCode?: string;

  constructor(
    message: string,
    {
      status,
      code,
      data,
      failureKind,
      reportEndpoint,
      reportMethod,
      errorCode,
    }: {
      status: number;
      code?: number;
      data?: unknown;
      failureKind?: string;
      reportEndpoint?: string;
      reportMethod?: string;
      errorCode?: string;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    this.failureKind = failureKind;
    this.reportEndpoint = reportEndpoint;
    this.reportMethod = reportMethod;
    this.errorCode = errorCode;
  }
}
