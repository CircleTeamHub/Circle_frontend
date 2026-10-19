import type { JournalRecord } from './index.js';
export function sealJournal(key: Uint8Array, scope: string, revision: number, record: unknown): Uint8Array;
export function openJournal<T = JournalRecord>(key: Uint8Array, scope: string, revision: number, sealed: Uint8Array): T;
