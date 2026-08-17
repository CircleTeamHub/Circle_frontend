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

function hasExplicitItems(items: unknown) {
  return Array.isArray(items);
}

export function buildNoteSections(note: StructuredNoteInput): NoteSections {
  const explicit = note.sections;
  const legacyMedia = normalizeItems(note.media);
  const legacyShowcase = getLegacyShowcaseItems(note);
  const hasExplicitMedia = hasExplicitItems(explicit?.media?.items);
  const hasExplicitShowcase = hasExplicitItems(explicit?.showcase?.items);
  const explicitMedia = normalizeItems(explicit?.media?.items);
  const explicitShowcase = normalizeItems(explicit?.showcase?.items);

  return {
    text: {
      content: explicit?.text?.content ?? note.content ?? null,
      contentJson: getTextBlocks(explicit?.text?.contentJson ?? note.contentJson),
    },
    media: {
      items: hasExplicitMedia
        ? explicitMedia
        : hasExplicitShowcase
          ? []
          : legacyMedia,
    },
    showcase: {
      items: hasExplicitShowcase
        ? explicitShowcase
        : hasExplicitMedia
          ? []
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

/**
 * 打开详情页时要定位到哪个区块。
 *
 * 只认**显式请求**（从「查看定位」等入口带 section 参数进来）；没请求就返回
 * null，让页面停在顶部——普通点开一条笔记，第一眼该看到标题，而不是被自动
 * 滚过标题落到正文。回落到「第一个有内容的区块」曾让每次点开都跳一下。
 */
export function getInitialNoteSection(
  requested: string | null | undefined,
  sections: NoteSections,
): NoteSectionKind | null {
  if (
    requested !== 'text' &&
    requested !== 'media' &&
    requested !== 'showcase' &&
    requested !== 'location'
  ) {
    return null;
  }
  const availability = getNoteSectionAvailability(sections);
  const key = `has${requested[0].toUpperCase()}${requested.slice(1)}` as keyof typeof availability;
  // 请求的区块没内容（笔记被编辑过）：不滚，停顶部比滚到空处强。
  return availability[key] ? requested : null;
}
