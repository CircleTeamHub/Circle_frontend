// A journal save moves these append-only records into separately encrypted rows
// in the SAME transaction as the ratchet. Retrying must never regenerate a packet.
export function splitRecord(record) {
  const items = [];
  for (const bucket of ['inbox', 'outbox']) {
    for (const [id, value] of Object.entries(record[bucket] ?? {})) items.push({ bucket, id, value });
  }
  const hot = { ...record };
  for (const bucket of ['inbox', 'outbox']) if (record[bucket]) hot[bucket] = {};
  return { hot, items };
}
export async function getItem(journal, record, bucket, id) {
  return record[bucket]?.[id] ?? (journal.getItem ? await journal.getItem(bucket, id) : undefined);
}
export async function pageItems(journal, bucket, after = '', limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid archive page size');
  if (journal.pageItems) return journal.pageItems(bucket, after, limit);
  const { record } = await journal.load();
  return Object.entries(record[bucket] ?? {}).filter(([id]) => id > after).sort(([a], [b]) => a < b ? -1 : 1).slice(0, limit).map(([id, value]) => ({ id, value }));
}
