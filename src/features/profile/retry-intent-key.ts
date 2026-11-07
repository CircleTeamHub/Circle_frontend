import { isUnsettledMutationFailure } from '@/services/api/mutation-outcome';

export class RetryIntentKeyStore {
  private pending: { signature: string; key: string } | null = null;

  constructor(private readonly generateKey: () => string) {}

  get(signature: string): string {
    if (this.pending?.signature === signature) {
      return this.pending.key;
    }
    const key = this.generateKey();
    this.pending = { signature, key };
    return key;
  }

  complete(signature: string, key: string): boolean {
    if (
      this.pending?.signature !== signature ||
      this.pending.key !== key
    ) {
      return false;
    }
    this.pending = null;
    return true;
  }

  /**
   * 带这次意图的幂等键执行写操作。成功或服务端明确拒绝后键作废;结果不明(超时/
   * 5xx/IDEMPOTENCY_IN_PROGRESS)时留着 —— 同一意图再试还是这个键,服务端回放
   * 第一次的结果,而不是再建一份。
   */
  async run<T>(signature: string, write: (key: string) => Promise<T>): Promise<T> {
    const key = this.get(signature);
    try {
      const result = await write(key);
      this.complete(signature, key);
      return result;
    } catch (error) {
      if (!isUnsettledMutationFailure(error)) this.complete(signature, key);
      throw error;
    }
  }
}
