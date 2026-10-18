export interface DeviceIdentity { userId: string; deviceId: string; publicKey: string }
export interface Envelope {
  version: 1;
  protocol: 'mls10';
  conversationId: string;
  senderDeviceId: string;
  clientMessageId: string;
  epoch: string;
  ciphertext: string;
}
export interface Invitation { encoded: string; signature: string }
export interface MembershipChange { commit: string; welcome: Invitation | null }
export interface DecryptedMessage {
  conversationId: string; senderDeviceId: string; clientMessageId: string;
  body: Record<string, unknown>; ciphertext?: string;
}
export interface JournalRecord {
  userId: string;
  deviceId: string;
  signing: { publicKey: string; signKey: string };
  pending: unknown;
  groups: Record<string, { state: string; manager: string }>;
  outbox: Record<string, { fingerprint: string; packet: Envelope | MembershipChange }>;
  inbox: Record<string, DecryptedMessage>;
  trustedDevices?: Record<string, DeviceIdentity>;
}
export type ArchiveBucket = 'inbox' | 'outbox';
export interface ArchiveItem { id: string; value: any }
export interface Journal {
  getItem?(bucket: ArchiveBucket, id: string): Promise<any>;
  pageItems?(bucket: ArchiveBucket, after: string, limit: number): Promise<ArchiveItem[]>;
  load(): Promise<{ revision: number; record: JournalRecord | null }> | { revision: number; record: JournalRecord | null };
  save(revision: number, record: JournalRecord, beforeCommit?: () => void): Promise<void> | void;
}
export class ProtocolDevice {
  static open(journal: Journal, userId: string, deviceId: string, pins: Map<string, DeviceIdentity>): Promise<ProtocolDevice>;
  readonly userId: string;
  readonly deviceId: string;
  readonly journal: Journal;
  readonly pins: Map<string, DeviceIdentity>;
  publicIdentity(): DeviceIdentity;
  confirmIdentity(identity: DeviceIdentity): Promise<void>;
  publishKeyPackage(): Promise<string>;
  create(conversationId: string): Promise<void>;
  changeMembers(conversationId: string, id: string, changes?: { add?: string[]; remove?: string[] }): Promise<MembershipChange>;
  join(conversationId: string, managerDeviceId: string, invitation: Invitation): Promise<void>;
  receiveCommit(conversationId: string, encoded: string, committerDeviceId?: string): Promise<void>;
  send(conversationId: string, id: string, body: Record<string, unknown>): Promise<Envelope>;
  receive(envelope: Envelope): Promise<Record<string, unknown>>;
  message(envelope: Envelope): Promise<DecryptedMessage | undefined>;
  messagePage(after?: string, limit?: number): Promise<ArchiveItem[]>;
  importMessage(message: DecryptedMessage): Promise<void>;
  messages(): Promise<DecryptedMessage[]>;
  signPayload(action: string, payload: unknown): Promise<string>;
  verifyPayload(identity: DeviceIdentity, action: string, payload: unknown, signature: string): Promise<boolean>;
  snapshot(conversationId: string): Promise<{ epoch: string; managerDeviceId: string; devices: { userId: string; deviceId: string }[] }>;
}
export function b64(bytes: Uint8Array): string;
export function unb64(value: string): Uint8Array;
