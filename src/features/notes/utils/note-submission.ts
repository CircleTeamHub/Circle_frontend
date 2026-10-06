import type { CreateNoteInput, CreateNoteMediaInput, NoteDetail, NoteMedia } from '@/features/notes/types';
import { ApiError } from '@/services/api/api-error';
import { MAX_NOTE_TITLE_LENGTH } from '@/features/notes/utils/note-text-stats';

export type PendingNoteSubmission = {
  noteId: string | null;
  input: CreateNoteInput;
  conflictingNoteId?: string;
};

export function createPendingNoteSubmission(input: CreateNoteInput, noteId: string | null): PendingNoteSubmission {
  // Private media is identified by its object key. Read signatures are neither
  // part of the write intent nor useful after restoring the submission later.
  const snapshot = JSON.parse(JSON.stringify(input, (_key, value) => {
    if (value && typeof value === 'object' && typeof value.objectKey === 'string') {
      const item = { ...value };
      if (typeof item.url === 'string' && /[?#]|^(blob:|file:)/i.test(item.url)) delete item.url;
      if (typeof item.posterUrl === 'string') item.posterUrl = item.posterUrl.split(/[?#]/)[0];
      return item;
    }
    return value;
  })) as CreateNoteInput;
  return { noteId, input: snapshot };
}

/** Only a complete, explicit rejection allows the frozen write to be edited. */
export function isDefinitiveNoteSubmissionFailure(error: unknown): boolean {
  return error instanceof ApiError && error.failureKind === 'http' &&
    error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409;
}

function canonicalBlocks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalBlocks);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().flatMap((key) => {
    if (typeof record.objectKey === 'string' && (key === 'url' || key === 'posterUrl')) return [];
    if (typeof record.type === 'string' && key === 'id') return [];
    return [[key, canonicalBlocks(record[key])]];
  }));
}

/** A replay from an older client/device must not acknowledge a different write. */
export function noteSubmissionMatchesResult(pending: PendingNoteSubmission, result: NoteDetail): boolean {
  const input = pending.input;
  const title = Array.from(input.title.trim()).slice(0, MAX_NOTE_TITLE_LENGTH).join('');
  if (!result || typeof result.id !== 'string' || (title && result.title !== title) ||
    (pending.noteId !== null && result.id !== pending.noteId)) return false;
  const same = (a: unknown, b: unknown) => JSON.stringify(canonicalBlocks(a)) === JSON.stringify(canonicalBlocks(b));
  if (!(input.contentJson?.length || input.sections?.text?.contentJson?.length) &&
    (input.sections?.text?.content ?? input.content ?? '').trim() !== (result.content ?? '').trim()) return false;
  if (!same(input.sections?.text?.contentJson ?? input.contentJson ?? [], result.sections?.text?.contentJson ?? result.contentJson ?? [])) return false;
  const keys = (items: readonly { type: string; objectKey: string }[] | undefined) =>
    (items ?? []).map((item) => `${item.type}:${item.objectKey}`);
  // The server uses top-level media metadata for each section reference. It
  // preserves supplied values, while omitted values can be resolved later.
  const submittedMedia = input.media.length ? input.media :
    (['media', 'showcase', 'audio'] as const).flatMap((section) => input.sections?.[section]?.items ?? []);
  const submittedByKey = new Map(submittedMedia.map((item) => [`${item.type}:${item.objectKey}`, item]));
  const sameMedia = (expected: CreateNoteMediaInput | NoteMedia, actual: CreateNoteMediaInput | NoteMedia | undefined) =>
    actual?.type === expected.type && actual.objectKey === expected.objectKey &&
    (['mimeType', 'size', 'width', 'height', 'durationMs'] as const).every((field) =>
      expected[field] == null || actual[field] === expected[field]);
  for (const item of input.media) {
    if (!sameMedia(item, result.media?.find((candidate) => candidate.type === item.type && candidate.objectKey === item.objectKey))) return false;
  }
  for (const section of ['media', 'showcase', 'audio'] as const) {
    const expected = input.sections?.[section]?.items ?? [];
    const actual = result.sections?.[section]?.items ?? [];
    if (!same(keys(expected), keys(actual))) return false;
    if (!expected.every((item, index) => sameMedia(submittedByKey.get(`${item.type}:${item.objectKey}`) ?? item, actual[index]))) return false;
  }
  for (const section of ['contacts', 'groups'] as const) {
    if (!same((input.sections?.[section]?.items ?? []).map((item) => item.id), (result.sections?.[section]?.items ?? []).map((item) => item.id))) return false;
  }
  const location = (value: typeof input.sections) => Object.fromEntries(
    ['title', 'address', 'latitude', 'longitude'].map((key) => {
      const field = (value?.location as Record<string, unknown> | null | undefined)?.[key];
      return [key, typeof field === 'string' ? field.trim() || null : field ?? null];
    }),
  );
  return same(location(input.sections), location(result.sections ?? undefined)) &&
    same([...new Set(input.groupIds ?? [])].sort(), [...new Set((result.groups ?? []).map((group) => group.id))].sort()) &&
    (input.pinned === undefined || input.pinned === result.pinned);
}
