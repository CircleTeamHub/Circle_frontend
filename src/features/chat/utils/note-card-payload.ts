import type { NoteSummary } from '../../notes/types';
import type { NoteCardData, NoteCardPeerSnapshot } from '../../../types';

function normalizePeerSnapshot(value: unknown): NoteCardPeerSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  if (!id || !name) return null;
  const faceURL =
    typeof raw.faceURL === 'string' && /^https?:\/\//i.test(raw.faceURL)
      ? raw.faceURL
      : null;
  return { id, name, faceURL };
}

function finiteNonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function normalizeWorkStatus(value: unknown): NoteCardData['workStatus'] {
  return value === 'WORKING' || value === 'CLOSED' || value === 'UNSET'
    ? value
    : 'UNSET';
}

function normalizePublicationStatus(value: unknown): NoteCardData['publicationStatus'] {
  return value === 'ACTIVE' || value === 'UNLISTED' || value === 'DELETED'
    ? value
    : 'ACTIVE';
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
  const personalCardSnapshot = normalizePeerSnapshot(candidate.personalCardSnapshot);
  const sourceGroupCardSnapshot = normalizePeerSnapshot(candidate.sourceGroupCardSnapshot);

  return {
    noteId: candidate.noteId,
    ...(typeof candidate.sourceNoteId === 'string' && candidate.sourceNoteId.length > 0
      ? { sourceNoteId: candidate.sourceNoteId }
      : {}),
    ...(personalCardSnapshot ? { personalCardSnapshot } : {}),
    ...(sourceGroupCardSnapshot ? { sourceGroupCardSnapshot } : {}),
    ownerId: candidate.ownerId ?? null,
    title: candidate.title,
    contentPreview,
    coverUrl: typeof candidate.coverUrl === 'string' ? candidate.coverUrl : null,
    imageCount,
    videoCount,
    // 私有笔记分组只能在「我的笔记」里出现，不能随聊天卡片泄露。
    groupNames: [],
    workStatus: normalizeWorkStatus(candidate.workStatus),
    publicationStatus: normalizePublicationStatus(candidate.publicationStatus),
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
    typeof note.hasText === 'boolean'
      ? note.hasText
      : Boolean(explicitText?.content?.trim()) ||
        (Array.isArray(explicitText?.contentJson) && explicitText.contentJson.length > 0) ||
        Boolean(note.contentPreview?.trim());
  const showcaseCount =
    typeof note.showcaseCount === 'number'
      ? Math.max(0, note.showcaseCount)
      : note.sections?.showcase?.items.length ??
        (note.cover ? 1 : note.imageCount ?? 0);
  const contact = note.sections?.contacts?.items?.[0];
  const personalCardSnapshot = contact
    ? normalizePeerSnapshot({
        id: contact.userId ?? contact.id,
        name: contact.name,
        faceURL: contact.faceURL ?? contact.avatarUrl,
      })
    : null;
  const group = note.sections?.groups?.items?.[0];
  const sourceGroupCardSnapshot = group
    ? normalizePeerSnapshot({
        id: group.groupId ?? group.id,
        name: group.name,
        faceURL: group.faceURL ?? group.avatarUrl,
      })
    : null;
  return {
    noteId: note.id,
    sourceNoteId: note.collectedFrom?.sourceNoteId ?? note.id,
    ...(personalCardSnapshot ? { personalCardSnapshot } : {}),
    ...(sourceGroupCardSnapshot ? { sourceGroupCardSnapshot } : {}),
    ownerId: ownerId ?? note.ownerId ?? null,
    title: note.title,
    contentPreview: note.contentPreview ?? null,
    coverUrl: note.cover?.url ?? null,
    imageCount: note.imageCount ?? 0,
    videoCount: note.videoCount ?? 0,
    // NoteSummary.groups 是当前用户的私人分组；聊天投影不携带它。
    groupNames: [],
    workStatus:
      note.workStatus === 'WORKING' || note.workStatus === 'CLOSED' || note.workStatus === 'UNSET'
        ? note.workStatus
        : 'UNSET',
    publicationStatus:
      note.status === 'ACTIVE' || note.status === 'UNLISTED' || note.status === 'DELETED'
        ? note.status
        : 'ACTIVE',
    hasText,
    showcaseCount,
    hasLocation:
      typeof note.hasLocation === 'boolean'
        ? note.hasLocation
        : Boolean(note.sections?.location),
  };
}
