import type { ProtocolDevice, Envelope } from './index';
export interface PublicDevice { id: string; userID: string; publicKey: string; label: string; purpose: 'APP' | 'AUDIT'; status: 'PENDING' | 'ACTIVE' | 'REVOKED'; packages?: { id: string; encoded: string; signature: string }[] }
export interface EncryptedContent { envelope: Envelope; signature: string }
export interface Directory { mode: string; members: string[]; devices: PublicDevice[]; room: { epoch: number; managerDeviceID: string } | null }
export class EncryptionClient {
  constructor(device: ProtocolDevice, request: (path: string, method: 'GET' | 'POST', body?: unknown) => Promise<any>, uuid: () => string, purpose?: 'APP' | 'AUDIT');
  readonly device: ProtocolDevice;
  run<T>(work: () => Promise<T>): Promise<T>;
  register(label: string): Promise<PublicDevice>;
  publish(): Promise<unknown>;
  devices(): Promise<PublicDevice[]>;
  trust(devices: PublicDevice[]): Promise<void>;
  deviceAction(target: PublicDevice, action: 'approve' | 'revoke'): Promise<PublicDevice>;
  directory(id: string): Promise<Directory>;
  isEncrypted(id: string): Promise<boolean>;
  enable(id: string): Promise<void>;
  reconcile(id: string): Promise<void>;
  sync(id: string, reason?: string): Promise<unknown>;
  encrypt(id: string, clientMessageId: string, body: Record<string, unknown>): Promise<EncryptedContent>;
  recoveryInfo(): Promise<{ id: string; publicKey: string } | null>;
  createRecovery(): Promise<string>;
  recover(code: string): Promise<void>;
  backupHistory(reason?: string, onProgress?: (count: number) => void): Promise<number>;
  restoreHistory(reason?: string, onProgress?: (count: number) => void): Promise<number>;
  decrypt(content: EncryptedContent, reason?: string): Promise<Record<string, unknown>>;
}
