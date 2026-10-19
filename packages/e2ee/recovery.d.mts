export function createRecoveryCode(): string;
export function openRecoveryKey(code: string, userId: string, purpose: 'APP' | 'AUDIT'): {
  publicKey: string;
  sign(action: string, payload: unknown): string;
  seal(recoveryId: string, ref: string[], value: unknown): string;
  open<T = any>(recoveryId: string, ref: string[], sealed: string): T;
  close(): void;
};
