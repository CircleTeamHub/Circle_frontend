/**
 * 轻量运行时 shape 守。**不**意图替代 Zod —— 只是给关键边界（钱、上传 URL、未读数等
 * 一旦类型漂移就出大问题的端点）一个低成本的保险栓。
 *
 * 设计取舍：
 *  - 不引入新依赖；不破坏 TypeScript 推断。
 *  - 失败时抛 `Error('xxx 返回数据格式异常')`，与 client.ts 现有错误风格一致。
 *  - 调用方仍以 `apiClient<T>` 拿到 TS 推断的 T，运行时通过 `expect*` 守一层。
 *
 * 后续若要全量做 schema，建议迁 Zod；这套 helper 只是当前的够用版本。
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * 通用断言：predicate 不过抛错。fallback message 给用户可见的中文文案。
 * predicate 拿到 unknown，由 caller 决定形状。
 */
export function expectShape<T>(
  value: unknown,
  predicate: (v: unknown) => v is T,
  message: string,
): T {
  if (!predicate(value)) {
    throw new Error(message);
  }
  return value;
}
