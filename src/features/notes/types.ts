export type NoteStatus = 'ACTIVE' | 'UNLISTED' | 'DELETED';
export type NoteMediaType = 'IMAGE' | 'VIDEO';

export interface NoteMediaSummary {
  id: string;
  type: NoteMediaType;
  url: string;
}

export interface NoteMedia {
  id: string;
  type: NoteMediaType;
  objectKey: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  posterUrl: string | null;
  sortOrder: number;
}

export interface NoteGroup {
  id: string;
  name: string;
  sortOrder: number;
  noteCount: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  contentPreview: string | null;
  status: NoteStatus;
  available: boolean;
  pinned: boolean;
  groups: { id: string; name: string }[];
  cover: NoteMediaSummary | null;
  imageCount: number;
  videoCount: number;
  mediaCount: number;
  createdAt: string;
  updatedAt: string;
  ownerId?: string | null;
  canEdit?: boolean;
}

export interface NoteDetail extends NoteSummary {
  content: string | null;
  contentJson: Record<string, unknown>[] | null;
  media: NoteMedia[];
}

export interface CreateNoteMediaInput {
  type: NoteMediaType;
  objectKey: string;
  url: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  posterUrl?: string;
  sortOrder: number;
}

export interface CreateNoteInput {
  title: string;
  content?: string;
  contentJson?: Record<string, unknown>[];
  groupIds?: string[];
  status?: 'ACTIVE' | 'UNLISTED';
  pinned?: boolean;
  media: CreateNoteMediaInput[];
}

export interface ListNotesParams {
  status?: NoteStatus;
  groupId?: string;
  search?: string;
}

export interface CreateNoteShareLinkInput {
  title: string;
  status?: Exclude<NoteStatus, 'DELETED'>;
  group?: 'ungrouped';
  groupId?: string;
  search?: string;
  noteIds?: string[];
}

export interface NoteShareLink {
  id: string;
  token: string;
  url: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
