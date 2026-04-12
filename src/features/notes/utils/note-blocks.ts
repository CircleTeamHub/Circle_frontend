import type { CreateNoteMediaInput } from '@/features/notes/types';

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
 * sortOrder is assigned by position in the block array.
 */
export function extractMediaFromBlocks(blocks: Block[]): CreateNoteMediaInput[] {
  const media: CreateNoteMediaInput[] = [];
  let sortOrder = 0;
  for (const block of blocks) {
    const type = block.type as string;
    const props = (block.props ?? {}) as Record<string, unknown>;
    if (type === 'image' && typeof props.url === 'string' && props.url) {
      media.push({
        type: 'IMAGE',
        objectKey: typeof props.objectKey === 'string' ? props.objectKey : '',
        url: props.url as string,
        width: typeof props.width === 'number' ? props.width : undefined,
        height: typeof props.height === 'number' ? props.height : undefined,
        mimeType: typeof props.mimeType === 'string' ? props.mimeType : undefined,
        size: typeof props.size === 'number' ? props.size : undefined,
        sortOrder: sortOrder++,
      });
    }
  }
  return media;
}
