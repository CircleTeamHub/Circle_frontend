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
}
