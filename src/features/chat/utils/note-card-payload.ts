import type { NoteSummary } from '../../notes/types';
import type { NoteCardData } from '../../../types';

function finiteNonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function normalizeNoteCardPayload(raw: unknown): NoteCardData | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<NoteCardData>;
  if (typeof candidate.noteId !== 'string' || typeof candidate.title !== 'string') {
    return null;
  }

  const imageCount = finiteNonNegative(candidate.imageCount);
  const videoCount = finiteNonNegative(candidate.videoCount);
  const contentPreview =
    typeof candidate.contentPreview === 'string' ? candidate.contentPreview : null;

  return {
    noteId: candidate.noteId,
    ownerId: candidate.ownerId ?? null,
    title: candidate.title,
    contentPreview,
    coverUrl: typeof candidate.coverUrl === 'string' ? candidate.coverUrl : null,
    imageCount,
    videoCount,
    groupNames: Array.isArray(candidate.groupNames) ? candidate.groupNames : [],
    hasText:
      typeof candidate.hasText === 'boolean'
        ? candidate.hasText
        : Boolean(contentPreview?.trim()),
    showcaseCount:
      typeof candidate.showcaseCount === 'number'
        ? Math.max(0, candidate.showcaseCount)
        : imageCount,
    hasLocation:
      typeof candidate.hasLocation === 'boolean' ? candidate.hasLocation : false,
  };
}

export function buildNoteCardPayloadFromSummary(
  note: NoteSummary,
  ownerId: string | null | undefined,
): NoteCardData {
  const explicitText = note.sections?.text;
  const hasText =
    Boolean(explicitText?.content?.trim()) ||
    (Array.isArray(explicitText?.contentJson) && explicitText.contentJson.length > 0) ||
    Boolean(note.contentPreview?.trim());
  const showcaseCount =
    note.sections?.showcase?.items.length ??
    (note.cover ? 1 : note.imageCount ?? 0);
  return {
    noteId: note.id,
    ownerId: ownerId ?? note.ownerId ?? null,
    title: note.title,
    contentPreview: note.contentPreview ?? null,
    coverUrl: note.cover?.url ?? null,
    imageCount: note.imageCount ?? 0,
    videoCount: note.videoCount ?? 0,
    groupNames: note.groups.map((group) => group.name),
    hasText,
    showcaseCount,
    hasLocation: Boolean(note.sections?.location),
  };
}
