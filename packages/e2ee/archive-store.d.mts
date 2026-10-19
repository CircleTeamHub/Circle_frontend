import type { Journal, JournalRecord, ArchiveBucket, ArchiveItem } from './index';
export function splitRecord(record: JournalRecord): { hot: JournalRecord; items: { bucket: ArchiveBucket; id: string; value: unknown }[] };
export function getItem(journal: Journal, record: JournalRecord, bucket: ArchiveBucket, id: string): Promise<any>;
export function pageItems(journal: Journal, bucket: ArchiveBucket, after?: string, limit?: number): Promise<ArchiveItem[]>;
