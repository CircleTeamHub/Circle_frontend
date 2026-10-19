import type { Journal } from './index';
export function openBrowserJournal(userId: string, password: string, databaseName?: string): Promise<Journal & { deviceId: string; close(): Promise<void> }>;
