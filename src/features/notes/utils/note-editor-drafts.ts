import { storage } from '@/storage';
import type {
  EditorNoteMediaDraft,
  NoteSections,
} from '@/features/notes/types';
import type { NoteComposerBlock } from '@/features/notes/utils/note-composer';

const INDEX_VERSION = 1;
const INDEX_PREFIX = 'circle-im-note-draft-index:v1:';
const DRAFT_PREFIX = 'circle-im-note-draft:v1:';

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
  return readIndex(userId).items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadLocalNoteDraft(
  userId: string | null | undefined,
  draftId: string,
): NoteEditorDraftRecord | null {
  const value = parseJson<NoteEditorDraftRecord>(
    storage.getString(draftKey(userId, draftId)),
  );
  if (!value || value.version !== 1 || value.id !== draftId) return null;
  return value;
}

export function saveLocalNoteDraft(
  userId: string | null | undefined,
  record: NoteEditorDraftRecord,
): void {
  const summary = toSummary(record);
  storage.set(draftKey(userId, record.id), JSON.stringify(record));
  const index = readIndex(userId);
  const items = [summary, ...index.items.filter((item) => item.id !== record.id)];
  writeIndex(userId, {
    version: INDEX_VERSION,
    items: items.slice(0, 100),
  });
  for (const evicted of items.slice(100)) {
    storage.remove(draftKey(userId, evicted.id));
  }
}

export function removeLocalNoteDraft(
  userId: string | null | undefined,
  draftId: string,
): void {
  storage.remove(draftKey(userId, draftId));
  const index = readIndex(userId);
  writeIndex(userId, {
    version: INDEX_VERSION,
    items: index.items.filter((item) => item.id !== draftId),
  });
}

export function removeAllLocalNoteDrafts(
  userId: string | null | undefined,
): void {
  for (const item of readIndex(userId).items) {
    storage.remove(draftKey(userId, item.id));
  }
  storage.remove(indexKey(userId));
}

export function localDraftSummaryToServerInput(record: NoteEditorDraftRecord) {
  return {
    title: record.title,
    content: record.content,
    contentJson: record.contentJson,
    sections: record.sections,
    groupIds: record.groupIds,
    sourceNoteId: record.noteId,
    mediaKeys: record.mediaKeys,
  };
}
