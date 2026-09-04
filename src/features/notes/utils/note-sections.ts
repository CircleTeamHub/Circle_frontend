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

type MediaAliasGroup = {
  item: StructuredNoteMediaItem;
  aliases: Set<string>;
};

function getMediaAliases(item: StructuredNoteMediaItem) {
  const aliases = new Set<string>();
  const objectKey = typeof item.objectKey === 'string' ? item.objectKey.trim() : '';
  if (objectKey) aliases.add(`${item.type}:key:${objectKey}`);
  const url = item.url.trim();
  if (url) aliases.add(`${item.type}:url:${url}`);
  return aliases;
}

function aliasesOverlap(left: Set<string>, right: Set<string>) {
  return [...left].some((alias) => right.has(alias));
}

function mergeMissingMediaMetadata(
  primary: StructuredNoteMediaItem,
  duplicate: StructuredNoteMediaItem,
) {
  const merged = { ...primary } as Record<string, unknown>;
  for (const [key, value] of Object.entries(duplicate)) {
    const current = merged[key];
    if (value != null && (current == null || current === '')) {
      merged[key] = value;
    }
  }
  return merged as StructuredNoteMediaItem;
}

function enrichMediaItems(
  items: StructuredNoteMediaItem[],
  references: StructuredNoteMediaItem[],
) {
  const referenceGroups = groupMediaItems(references);
  return items.map((item) =>
    referenceGroups.reduce(
      (enriched, reference) =>
        aliasesOverlap(getMediaAliases(enriched), reference.aliases)
          ? mergeMissingMediaMetadata(enriched, reference.item)
          : enriched,
      item,
    ),
  );
}

function dedupeAndNormalizeMedia(items: StructuredNoteMediaItem[]) {
  return groupMediaItems(items).map(({ item }, sortOrder) => ({ ...item, sortOrder }));
}

function groupMediaItems(items: StructuredNoteMediaItem[]) {
  const groups: MediaAliasGroup[] = [];
  for (const item of items) {
    const aliases = getMediaAliases(item);
    const matchingIndexes = groups.flatMap((group, index) =>
      aliasesOverlap(group.aliases, aliases) ? [index] : [],
    );
    if (!matchingIndexes.length) {
      groups.push({ item, aliases });
      continue;
    }

    const primaryIndex = matchingIndexes[0];
    let merged = groups[primaryIndex].item;
    const mergedAliases = new Set(groups[primaryIndex].aliases);
    for (const index of matchingIndexes.slice(1)) {
      merged = mergeMissingMediaMetadata(merged, groups[index].item);
      for (const alias of groups[index].aliases) mergedAliases.add(alias);
    }
    groups[primaryIndex] = {
      item: mergeMissingMediaMetadata(merged, item),
      aliases: new Set([...mergedAliases, ...aliases]),
    };
    for (const index of matchingIndexes.slice(1).reverse()) {
      groups.splice(index, 1);
    }
  }
  return groups;
}

/**
 * Canonicalizes the two editable media regions. Showcase is intentionally video-only;
 * older showcase images are retained by moving them into ordinary media.
 */
export function normalizeNoteMediaSections({
  media,
  showcase,
  mediaReferences,
}: {
  media?: unknown;
  showcase?: unknown;
  mediaReferences?: unknown;
}) {
  const references = normalizeItems(mediaReferences);
  const ordinaryMedia = enrichMediaItems(normalizeItems(media), references);
  const showcaseItems = enrichMediaItems(normalizeItems(showcase), references);
  const migratedShowcaseImages = showcaseItems.filter((item) => item.type === 'IMAGE');

  return {
    media: dedupeAndNormalizeMedia([...ordinaryMedia, ...migratedShowcaseImages]),
    showcase: dedupeAndNormalizeMedia(
      showcaseItems.filter((item) => item.type === 'VIDEO'),
    ),
  };
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
  const legacyShowcaseImages = legacyShowcase.filter((item) => item.type === 'IMAGE');

  const mediaSections = normalizeNoteMediaSections({
    media: hasExplicitMedia
      ? explicitMedia
      : [...legacyMedia, ...legacyShowcaseImages],
    showcase: hasExplicitShowcase
      ? explicitShowcase
      : hasExplicitMedia
        ? []
        : legacyShowcase,
    mediaReferences: legacyMedia,
  });

  return {
    text: {
      content: explicit?.text?.content ?? note.content ?? null,
      contentJson: getTextBlocks(explicit?.text?.contentJson ?? note.contentJson),
    },
    media: {
      items: mediaSections.media,
    },
    showcase: {
      items: mediaSections.showcase,
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
  if (requested === 'showcase' && !availability.hasShowcase && availability.hasMedia) {
    return 'media';
  }
  const key = `has${requested[0].toUpperCase()}${requested.slice(1)}` as keyof typeof availability;
  // 请求的区块没内容（笔记被编辑过）：不滚，停顶部比滚到空处强。
  return availability[key] ? requested : null;
}
