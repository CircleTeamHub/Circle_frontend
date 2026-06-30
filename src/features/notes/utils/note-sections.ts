import type { NoteMedia } from '@/features/notes/types';

export type NoteSectionKind = 'text' | 'media' | 'showcase' | 'location';

export type StructuredNoteMediaItem = Partial<NoteMedia> & {
  id?: string;
  type: 'IMAGE' | 'VIDEO';
  url: string;
};

export type NoteTextSection = {
  content: string | null;
  contentJson: Record<string, unknown>[] | null;
};

export type NoteMediaSection = {
  items: StructuredNoteMediaItem[];
};

export type NoteShowcaseSection = {
  items: StructuredNoteMediaItem[];
};

export type NoteLocationSection = {
  title?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
} | null;

export type NoteSections = {
  text: NoteTextSection;
  media: NoteMediaSection;
  showcase: NoteShowcaseSection;
  location: NoteLocationSection;
};

export type StructuredNoteInput = {
  sections?: Partial<NoteSections> | null;
  content?: string | null;
  contentJson?: Record<string, unknown>[] | null;
  media?: NoteMedia[] | StructuredNoteMediaItem[] | null;
};

function getBlockType(block: Record<string, unknown>) {
  return typeof block.type === 'string' ? block.type : '';
}

function getBlockUrl(block: Record<string, unknown>) {
  const props = (block.props ?? {}) as Record<string, unknown>;
  return typeof props.url === 'string' ? props.url : '';
}

function isMediaBlock(block: Record<string, unknown>) {
  const type = getBlockType(block);
  return type === 'image' || type === 'video';
}

function getTextBlocks(blocks: Record<string, unknown>[] | null | undefined) {
  if (!Array.isArray(blocks)) return null;
  return blocks.filter((block) => !isMediaBlock(block));
}

function getLegacyShowcaseItems(note: StructuredNoteInput): StructuredNoteMediaItem[] {
  const blocks = note.contentJson ?? [];
  const byUrl = new Map(
    (note.media ?? [])
      .filter((item) => item.url)
      .map((item) => [item.url, item as StructuredNoteMediaItem]),
  );

  return blocks.flatMap((block, index) => {
    const type = getBlockType(block);
    if (type !== 'image') return [];
    const url = getBlockUrl(block);
    if (!url) return [];
    return [
      byUrl.get(url) ?? {
        id: `${type}-${index}`,
        type: 'IMAGE',
        url,
      },
    ];
  });
}

function normalizeItems(items: unknown): StructuredNoteMediaItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<StructuredNoteMediaItem>;
    if ((candidate.type !== 'IMAGE' && candidate.type !== 'VIDEO') || !candidate.url) {
      return [];
    }
    return [candidate as StructuredNoteMediaItem];
  });
}

export function buildNoteSections(note: StructuredNoteInput): NoteSections {
  const explicit = note.sections;
  const legacyMedia = normalizeItems(note.media);
  const legacyShowcase = getLegacyShowcaseItems(note);

  return {
    text: {
      content: explicit?.text?.content ?? note.content ?? null,
      contentJson: getTextBlocks(explicit?.text?.contentJson ?? note.contentJson),
    },
    media: {
      items: normalizeItems(explicit?.media?.items).length > 0
        ? normalizeItems(explicit?.media?.items)
        : legacyMedia,
    },
    showcase: {
      items: normalizeItems(explicit?.showcase?.items).length > 0
        ? normalizeItems(explicit?.showcase?.items)
        : legacyShowcase,
    },
    location: explicit?.location ?? null,
  };
}

export function getNoteSectionAvailability(sections: NoteSections) {
  const hasText =
    Boolean(sections.text.content?.trim()) ||
    Boolean(sections.text.contentJson && sections.text.contentJson.length > 0);
  return {
    hasText,
    hasMedia: sections.media.items.length > 0,
    hasShowcase: sections.showcase.items.length > 0,
    hasLocation: Boolean(
      sections.location &&
        ((sections.location.title && sections.location.title.trim()) ||
          (sections.location.address && sections.location.address.trim()) ||
          typeof sections.location.latitude === 'number' ||
          typeof sections.location.longitude === 'number'),
    ),
  };
}

export function getInitialNoteSection(
  requested: string | null | undefined,
  sections: NoteSections,
): NoteSectionKind {
  const availability = getNoteSectionAvailability(sections);
  const order: NoteSectionKind[] = ['text', 'media', 'showcase', 'location'];
  if (
    requested === 'text' ||
    requested === 'media' ||
    requested === 'showcase' ||
    requested === 'location'
  ) {
    const key = `has${requested[0].toUpperCase()}${requested.slice(1)}` as keyof typeof availability;
    if (availability[key]) return requested;
  }
  return (
    order.find((section) => {
      const key = `has${section[0].toUpperCase()}${section.slice(1)}` as keyof typeof availability;
      return availability[key];
    }) ?? 'text'
  );
}
