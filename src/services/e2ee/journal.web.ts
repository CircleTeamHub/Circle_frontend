import type { DeviceJournal } from './journal';

// Web must use the explicitly unlocked encrypted browser vault used by the
// admin console. Never reuse secure-kv.web's localStorage token adapter for keys.
export async function openDeviceJournal(_userId: string): Promise<DeviceJournal> {
  throw new Error('Encrypted chat requires an explicitly unlocked browser vault or the native app');
}

export async function prepareReplacementJournal(_userId: string): Promise<void> { throw new Error('Use the native encryption vault'); }
