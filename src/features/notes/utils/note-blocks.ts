import type { CreateNoteMediaInput, NoteMedia } from '@/features/notes/types';

type Block = Record<string, unknown>;

function getBlockText(block: Block): string {
  const content = block.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((inline: Record<string, unknown>) =>
      typeof inline.text === 'string' ? inline.text : '',
    )
    .join('');
}

/**
 * Flatten all text blocks into a single plain text string (for the `content` field).
 */
export function extractPlainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      const type = block.type as string;
      if (
        ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'quote'].includes(type)
      ) {
        return getBlockText(block);
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Extract image/video blocks from the document and return them as CreateNoteMediaInput[].
 * sortOrder is assigned by position in the block array. The block props only carry
 * `url` reliably — full metadata (objectKey, durationMs, ...) is merged back in by the
 * caller from the upload map keyed by url.
 */
export function extractMediaFromBlocks(blocks: Block[]): CreateNoteMediaInput[] {
  const media: CreateNoteMediaInput[] = [];
  let sortOrder = 0;
  for (const block of blocks) {
    const type = block.type as string;
    if (type !== 'image' && type !== 'video') continue;
    const props = (block.props ?? {}) as Record<string, unknown>;
    if (typeof props.url !== 'string' || !props.url) continue;
    media.push({
      type: type === 'video' ? 'VIDEO' : 'IMAGE',
      objectKey: typeof props.objectKey === 'string' ? props.objectKey : '',
      url: props.url,
      width: typeof props.width === 'number' ? props.width : undefined,
      height: typeof props.height === 'number' ? props.height : undefined,
      mimeType: typeof props.mimeType === 'string' ? props.mimeType : undefined,
      size: typeof props.size === 'number' ? props.size : undefined,
      durationMs: typeof props.durationMs === 'number' ? props.durationMs : undefined,
      posterUrl: typeof props.posterUrl === 'string' ? props.posterUrl : undefined,
      sortOrder: sortOrder++,
    });
  }
  return media;
}

export function buildNoteMediaMap(
  media: (NoteMedia | CreateNoteMediaInput)[],
): Record<string, CreateNoteMediaInput> {
  return Object.fromEntries(
    media
      .filter((item) => item.url)
      .map((item) => {
        const input: CreateNoteMediaInput = {
          type: item.type,
          objectKey: item.objectKey,
          url: item.url,
          sortOrder: item.sortOrder,
        };
        if (item.mimeType != null) input.mimeType = item.mimeType;
        if (item.size != null) input.size = item.size;
        if (item.width != null) input.width = item.width;
        if (item.height != null) input.height = item.height;
        if (item.durationMs != null) input.durationMs = item.durationMs;
        if (item.posterUrl != null) input.posterUrl = item.posterUrl;
        return [item.url, input];
      }),
  );
}

export function mergeExtractedMediaWithMediaMap(
  extracted: CreateNoteMediaInput[],
  mediaMap: Record<string, CreateNoteMediaInput>,
): CreateNoteMediaInput[] {
  return extracted.flatMap((item) => {
    const uploaded = mediaMap[item.url];
    if (uploaded) {
      return [{ ...uploaded, sortOrder: item.sortOrder }];
    }
    if (item.objectKey) {
      return [item];
    }
    return [];
  });
}
