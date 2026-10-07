import { storage } from '@/storage';
import type {
  EditorNoteMediaDraft,
  NoteSections,
} from '@/features/notes/types';
import type { NoteComposerBlock } from '@/features/notes/utils/note-composer';
import { isNoteRecordingId, removeNoteRecording, restoreNoteRecording } from '@/features/notes/utils/note-recording-storage';
import type { PendingNoteSubmission } from '@/features/notes/utils/note-submission';

const INDEX_VERSION = 1;
const INDEX_PREFIX = 'circle-im-note-draft-index:v1:';
const DRAFT_PREFIX = 'circle-im-note-draft:v1:';
const DELETION_PREFIX = 'circle-im-note-draft-deletions:v1:';
// Completed deletes still fence callbacks in this process. Across restarts
// only unfinished work needs retaining; completed server tombstones are final.
const deletedDrafts = new Set<string>();
type DraftDeletion = { id: string; recordingIds: string[] };

export type NoteDraftCardSnapshot = {
  id: string;
  name: string;
  faceURL?: string | null;
  avatarUrl?: string | null;
  subtitle?: string | null;
};

export type NoteEditorDraftRecord = {
  version: 1;
  id: string;
  noteId: string | null;
  title: string;
  content: string;
  contentJson: Record<string, unknown>[];
  sections: Partial<NoteSections>;
  groupIds: string[];
  mediaKeys: string[];
  composerBlocks: NoteComposerBlock[];
  textBlocksById: Record<string, Record<string, unknown>[]>;
  mediaItems: EditorNoteMediaDraft[];
  showcaseItems: EditorNoteMediaDraft[];
  audioItems: EditorNoteMediaDraft[];
  mediaOwnerByClientId: Record<string, string>;
  contactItems: NoteDraftCardSnapshot[];
  groupCardItems: NoteDraftCardSnapshot[];
  location: {
    title: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  };
  createdAt: number;
  updatedAt: number;
  pendingSubmission?: PendingNoteSubmission;
};

export type NoteLocalDraftSummary = {
  id: string;
  noteId: string | null;
  title: string;
  contentPreview: string;
  mediaCount: number;
  createdAt: number;
  updatedAt: number;
};

const SERVER_MEDIA_FIELDS = [
  'type',
  'objectKey',
  'url',
  'mimeType',
  'size',
  'width',
  'height',
  'durationMs',
  'posterUrl',
  'sortOrder',
] as const;

function sanitizeMediaSection(section: unknown) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return undefined;
  }
  const rawItems = (section as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return { items: [] };

  const items = rawItems.flatMap((rawItem, index) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      return [];
    }
    const source = rawItem as Record<string, unknown>;
    if (
      (source.type !== 'IMAGE' && source.type !== 'VIDEO' && source.type !== 'AUDIO') ||
      typeof source.objectKey !== 'string' ||
      source.objectKey.trim() === ''
    ) {
      return [];
    }
    const item: Record<string, unknown> = {};
    for (const field of SERVER_MEDIA_FIELDS) {
      if (source[field] !== undefined) item[field] = source[field];
    }
    item.sortOrder = Number.isInteger(source.sortOrder) ? source.sortOrder : index;
    return [item];
  });

  return { items };
}

function sanitizeCardSection(section: unknown) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return undefined;
  }
  const rawItems = (section as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return { items: [] };

  const items = rawItems.flatMap((rawItem) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      return [];
    }
    const source = rawItem as Record<string, unknown>;
    if (
      typeof source.id !== 'string' ||
      source.id.trim() === '' ||
      typeof source.name !== 'string' ||
      source.name.trim() === ''
    ) {
      return [];
    }
    return [
      {
        id: source.id,
        name: source.name,
        ...(typeof source.faceURL === 'string' ? { faceURL: source.faceURL } : {}),
      },
    ];
  });

  return { items };
}

export function sanitizeNoteSectionsForServer(sections: Partial<NoteSections> | undefined) {
  if (!sections) return undefined;
  const sanitized: Partial<NoteSections> = {};

  if (sections.text) {
    sanitized.text = {
      content:
        typeof sections.text.content === 'string' ? sections.text.content : null,
      contentJson: Array.isArray(sections.text.contentJson)
        ? sections.text.contentJson
        : null,
    };
  }
  for (const [key, value] of [
    ['media', sections.media],
    ['showcase', sections.showcase],
    ['audio', sections.audio],
  ] as const) {
    const sanitizedSection = sanitizeMediaSection(value);
    if (sanitizedSection) {
      sanitized[key] = sanitizedSection as unknown as NoteSections[typeof key];
    }
  }

  const contacts = sanitizeCardSection(sections.contacts);
  if (contacts) sanitized.contacts = contacts;
  const groups = sanitizeCardSection(sections.groups);
  if (groups) sanitized.groups = groups;

  if (sections.location === null) {
    sanitized.location = null;
  } else if (sections.location && typeof sections.location === 'object') {
    sanitized.location = {
      ...(typeof sections.location.title === 'string'
        ? { title: sections.location.title }
        : {}),
      ...(typeof sections.location.address === 'string'
        ? { address: sections.location.address }
        : {}),
      ...(typeof sections.location.latitude === 'number'
        ? { latitude: sections.location.latitude }
        : {}),
      ...(typeof sections.location.longitude === 'number'
        ? { longitude: sections.location.longitude }
        : {}),
    };
  }

  return sanitized;
}

type DraftIndex = {
  version: 1;
  items: NoteLocalDraftSummary[];
};

function userKey(userId: string | null | undefined): string {
  return encodeURIComponent(userId?.trim() || 'anonymous');
}

function indexKey(userId: string | null | undefined): string {
  return `${INDEX_PREFIX}${userKey(userId)}`;
}

function draftKey(userId: string | null | undefined, draftId: string): string {
  return `${DRAFT_PREFIX}${userKey(userId)}:${encodeURIComponent(draftId)}`;
}

function readDeletions(userId: string | null | undefined): DraftDeletion[] {
  const value = parseJson<unknown>(storage.getString(`${DELETION_PREFIX}${userKey(userId)}`));
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item.id === 'string' && Array.isArray(item.recordingIds)
    ? [{ id: item.id, recordingIds: item.recordingIds.filter(isNoteRecordingId) }] : []);
}

function writeDeletions(userId: string | null | undefined, items: DraftDeletion[]): void {
  const key = `${DELETION_PREFIX}${userKey(userId)}`;
  const value = JSON.stringify(items);
  storage.set(key, value);
  if (storage.getString(key) !== value) throw new Error('Draft deletion was not stored');
}

export function isLocalNoteDraftDeleted(userId: string | null | undefined, draftId: string): boolean {
  return deletedDrafts.has(draftKey(userId, draftId)) || readDeletions(userId).some((item) => item.id === draftId);
}

export function loadPendingNoteDraftDeletions(userId: string | null | undefined): string[] {
  return readDeletions(userId).map((item) => item.id);
}

function parseJson<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readIndex(userId: string | null | undefined): DraftIndex {
  const value = parseJson<DraftIndex>(storage.getString(indexKey(userId)));
  if (!value || value.version !== INDEX_VERSION || !Array.isArray(value.items)) {
    return { version: INDEX_VERSION, items: [] };
  }
  return {
    version: INDEX_VERSION,
    items: value.items.filter((item) => item && typeof item.id === 'string'),
  };
}

function writeIndex(userId: string | null | undefined, index: DraftIndex): void {
  storage.set(indexKey(userId), JSON.stringify(index));
}

function contentPreview(record: NoteEditorDraftRecord): string {
  const content = record.content.trim();
  if (content) return content.slice(0, 180);
  const title = record.title.trim();
  if (title) return title;
  return '';
}

function toSummary(record: NoteEditorDraftRecord): NoteLocalDraftSummary {
  return {
    id: record.id,
    noteId: record.noteId,
    title: record.title.trim(),
    contentPreview: contentPreview(record),
    mediaCount:
      record.mediaItems.length + record.showcaseItems.length + record.audioItems.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createNoteDraftId(): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)
    ?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function loadLocalNoteDraftSummaries(
  userId: string | null | undefined,
): NoteLocalDraftSummary[] {
  return readIndex(userId).items.filter((item) => !isLocalNoteDraftDeleted(userId, item.id)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadLocalNoteDraft(
  userId: string | null | undefined,
  draftId: string,
): NoteEditorDraftRecord | null {
  if (isLocalNoteDraftDeleted(userId, draftId)) return null;
  return readLocalNoteDraft(userId, draftId);
}

function readLocalNoteDraft(userId: string | null | undefined, draftId: string): NoteEditorDraftRecord | null {
  const value = parseJson<NoteEditorDraftRecord>(
    storage.getString(draftKey(userId, draftId)),
  );
  if (!value || value.version !== 1 || value.id !== draftId) return null;
  return value;
}

export async function restoreLocalNoteDraftRecordings(
  userId: string,
  record: NoteEditorDraftRecord,
): Promise<NoteEditorDraftRecord> {
  return { ...record, audioItems: await Promise.all(record.audioItems.map(async (item) => {
    if (!item.localRecordingId) return item;
    const uri = await restoreNoteRecording(userId, item.localRecordingId).catch(() => undefined);
    return { ...item, previewUri: uri };
  })) };
}

/** Keep local edits/region ownership while refreshing private media previews. */
export function refreshLocalNoteDraftMedia(
  local: NoteEditorDraftRecord,
  remote: NoteEditorDraftRecord,
): NoteEditorDraftRecord {
  const refresh = (items: EditorNoteMediaDraft[], remoteItems: EditorNoteMediaDraft[]) =>
    items.map((item) => {
      if (item.uploadStatus !== 'UPLOADED') return item;
      const fresh = remoteItems.find((candidate) => candidate.objectKey === item.objectKey);
      return fresh ? { ...item, url: fresh.url, posterUrl: fresh.posterUrl, previewUri: undefined } : item;
    });
  return {
    ...local,
    mediaItems: refresh(local.mediaItems, remote.mediaItems),
    showcaseItems: refresh(local.showcaseItems, remote.showcaseItems),
    audioItems: refresh(local.audioItems, remote.audioItems),
  };
}

function recordingIds(record: NoteEditorDraftRecord | null): string[] {
  return record?.audioItems?.flatMap((item) => isNoteRecordingId(item.localRecordingId) ? [item.localRecordingId] : []) ?? [];
}

export function removeUnreferencedLocalNoteRecordings(userId: string | null | undefined, ids: readonly string[], excludedDraftId?: string): void {
  if (!userId) return;
  const candidates = new Set(ids.filter(isNoteRecordingId));
  if (!candidates.size) return;
  // Usually IDs belong to one draft. Preserve any ID still referenced by a
  // retained draft (including a copied/imported local snapshot).
  for (const item of readIndex(userId).items) {
    if (item.id === excludedDraftId) continue;
    for (const id of recordingIds(loadLocalNoteDraft(userId, item.id))) candidates.delete(id);
    if (!candidates.size) return;
  }
  for (const id of candidates) void removeNoteRecording(userId, id).catch(() => undefined);
}

function cleanRecordings(userId: string | null | undefined, record: NoteEditorDraftRecord | null, retained: ReadonlySet<string> = new Set()): void {
  removeUnreferencedLocalNoteRecordings(userId, recordingIds(record).filter((id) => !retained.has(id)));
}

export function saveLocalNoteDraft(
  userId: string | null | undefined,
  record: NoteEditorDraftRecord,
): void {
  if (isLocalNoteDraftDeleted(userId, record.id)) throw new Error('Draft has been deleted');
  const summary = toSummary(record);
  // A cache URI/blob URL cannot restore a failed recording upload after restart.
  // Never acknowledge saving that recording unless the durable copy exists.
  if (record.audioItems.some((item) => item.uploadStatus !== 'UPLOADED' && item.clientId.startsWith('recording:') && (!isNoteRecordingId(item.localRecordingId) || !item.previewUri))) {
    throw new Error('Recording has not been stored');
  }
  const previous = loadLocalNoteDraft(userId, record.id);
  const durableRecord = { ...record,
    // Picker Blob URLs belong to the mounted editor and are revoked on exit.
    mediaItems: record.mediaItems.map((item) => ({ ...item, previewUri: item.previewUri?.startsWith('blob:') ? undefined : item.previewUri })),
    showcaseItems: record.showcaseItems.map((item) => ({ ...item, previewUri: item.previewUri?.startsWith('blob:') ? undefined : item.previewUri })),
    audioItems: record.audioItems.map((item) =>
    item.localRecordingId || item.clientId.startsWith('recording:')
      ? { ...item, previewUri: undefined,
        // Canonical uploaded URLs remain usable without local storage. Private
        // signed query URLs are refreshed on hydration, never persisted here.
        url: item.uploadStatus === 'UPLOADED' && /^https?:\/\/[^?#]+$/i.test(item.url ?? '') ? item.url : undefined,
      } : item) };
  storage.set(draftKey(userId, record.id), JSON.stringify(durableRecord));
  const index = readIndex(userId);
  const items = [summary, ...index.items.filter((item) => item.id !== record.id)];
  writeIndex(userId, {
    version: INDEX_VERSION,
    items: items.slice(0, 100),
  });
  cleanRecordings(userId, previous, new Set(recordingIds(record)));
  for (const evicted of items.slice(100)) {
    const evictedRecord = loadLocalNoteDraft(userId, evicted.id);
    storage.remove(draftKey(userId, evicted.id));
    cleanRecordings(userId, evictedRecord);
  }
}

export function removeLocalNoteDraft(
  userId: string | null | undefined,
  draftId: string,
): void {
  const record = readLocalNoteDraft(userId, draftId);
  storage.remove(draftKey(userId, draftId));
  const index = readIndex(userId);
  writeIndex(userId, {
    version: INDEX_VERSION,
    items: index.items.filter((item) => item.id !== draftId),
  });
  cleanRecordings(userId, record);
}

/** Stage deletion before removing content; never discard a publication recovery marker. */
export function stageLocalNoteDraftDeletion(userId: string, draftId: string, additionalRecordingIds: readonly string[] = []): boolean {
  const record = readLocalNoteDraft(userId, draftId);
  if (record?.pendingSubmission) return false;
  const pending = readDeletions(userId);
  const existing = pending.find((item) => item.id === draftId);
  writeDeletions(userId, [
    ...pending.filter((item) => item.id !== draftId),
    { id: draftId, recordingIds: [...new Set([...(existing?.recordingIds ?? []), ...recordingIds(record), ...additionalRecordingIds.filter(isNoteRecordingId)])] },
  ]);
  deletedDrafts.add(draftKey(userId, draftId));
  // These removals are synchronous. File/Blob cleanup remains retryable using
  // only safe relative recording IDs, even once the private JSON is gone.
  removeDeletedDraftContent(userId, draftId);
  return true;
}

function removeDeletedDraftContent(userId: string, draftId: string): void {
  storage.remove(draftKey(userId, draftId));
  if (storage.getString(draftKey(userId, draftId)) !== undefined) throw new Error('Draft content was not removed');
  const index: DraftIndex = { version: INDEX_VERSION, items: readIndex(userId).items.filter((item) => item.id !== draftId) };
  writeIndex(userId, index);
  if (storage.getString(indexKey(userId)) !== JSON.stringify(index)) throw new Error('Draft summary was not removed');
}

/** A durable copy finishing after deletion must be cleaned with the same retry intent. */
export function retainDeletedNoteDraftRecording(userId: string, draftId: string, recordingId: string): void {
  if (!isNoteRecordingId(recordingId) || !isLocalNoteDraftDeleted(userId, draftId)) return;
  const pending = readDeletions(userId);
  const previous = pending.find((item) => item.id === draftId);
  writeDeletions(userId, [...pending.filter((item) => item.id !== draftId), {
    id: draftId, recordingIds: [...new Set([...(previous?.recordingIds ?? []), recordingId])],
  }]);
}

export async function finishLocalNoteDraftDeletion(userId: string, draftId: string): Promise<string> {
  const pending = readDeletions(userId).find((item) => item.id === draftId);
  if (!pending) return '[]';
  // Retry partial storage cleanup before acknowledging either local or remote deletion.
  removeDeletedDraftContent(userId, draftId);
  const retained = new Set(readIndex(userId).items.flatMap((item) => recordingIds(loadLocalNoteDraft(userId, item.id))));
  for (const id of pending.recordingIds) if (!retained.has(id)) await removeNoteRecording(userId, id);
  return JSON.stringify(pending.recordingIds);
}

/** Call only after local cleanup and the server's idempotent DELETE succeed. */
export function confirmNoteDraftDeletion(userId: string, draftId: string, cleanedRecordings: string): boolean {
  const current = readDeletions(userId);
  const pending = current.find((item) => item.id === draftId);
  // A late native/IDB copy can finish during server DELETE. Keep newly queued
  // files for another cleanup pass instead of acknowledging work never done.
  if (pending && JSON.stringify(pending.recordingIds) !== cleanedRecordings) return false;
  deletedDrafts.add(draftKey(userId, draftId));
  writeDeletions(userId, current.filter((item) => item.id !== draftId));
  return true;
}

export function removeAllLocalNoteDrafts(
  userId: string | null | undefined,
): void {
  const records = readIndex(userId).items.map((item) => loadLocalNoteDraft(userId, item.id));
  for (const item of readIndex(userId).items) {
    storage.remove(draftKey(userId, item.id));
  }
  storage.remove(indexKey(userId));
  records.forEach((record) => cleanRecordings(userId, record));
}

export function localDraftSummaryToServerInput(record: NoteEditorDraftRecord) {
  return {
    title: record.title,
    content: record.content,
    contentJson: record.contentJson,
    // The editor keeps clientId/uploadStatus/previewUri and richer card
    // snapshots locally. The backend's nested DTOs use forbidNonWhitelisted,
    // so send only the server contract or autosave becomes a repeated 400.
    sections: sanitizeNoteSectionsForServer(record.sections),
    groupIds: record.groupIds,
    sourceNoteId: record.noteId,
    mediaKeys: record.mediaKeys,
  };
}
