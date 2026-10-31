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
