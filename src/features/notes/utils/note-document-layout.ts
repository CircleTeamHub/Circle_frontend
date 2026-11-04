import { extractPlainText } from '@/features/notes/utils/note-blocks';
import {
  readNoteComposerBlocks,
  readNoteComposerTextBlocks,
  readNoteComposerMediaBlocks,
  restoreNoteComposerMediaBlocks,
  getNoteComposerMediaOwner,
  type NoteComposerBlockKind,
} from '@/features/notes/utils/note-composer';
import type { NoteSectionKind, NoteSections, StructuredNoteMediaItem } from './note-sections';

export type NoteDocumentInstance = { id: string; kind: NoteSectionKind; mediaKind?: 'image' | 'video'; sections: NoteSections };

function sectionKind(kind: NoteComposerBlockKind): NoteSectionKind | null {
  if (kind === 'title') return null;
  return kind === 'image' || kind === 'video' ? 'media' : kind;
}

/** Keep editable regions in their saved order, including repeated text/media kinds. */
export function getNoteDocumentInstances(
  sections: NoteSections,
  order: readonly NoteSectionKind[],
  layout: unknown,
): NoteDocumentInstance[] {
  const savedBlocks = readNoteComposerBlocks(layout);
  const textBlocks = readNoteComposerTextBlocks(layout);
  const mediaBlocks = readNoteComposerMediaBlocks(layout);
  const blocks = restoreNoteComposerMediaBlocks(savedBlocks ?? order.map((kind) => ({
    id: kind, kind: kind === 'media' ? 'image' : kind,
  })), sections);
  const firstText = blocks.find((block) => block.kind === 'text')?.id;
  const mediaFor = (id: string, target: 'media' | 'showcase') => {
    return sections[target].items.filter((item) => {
      const key = item.objectKey || item.url || '';
      const preferred = mediaBlocks.find((owner) => owner.target === target && owner.objectKeys.includes(key))?.id;
      return getNoteComposerMediaOwner(blocks, target, item.type, preferred) === id;
    });
  };
  const entries = blocks.flatMap((block): NoteDocumentInstance[] => {
    const kind = sectionKind(block.kind);
    if (!kind) return [];
    let ownSections = sections;
    if (kind === 'text') {
      const saved = textBlocks.find((entry) => entry.id === block.id);
      const contentJson = saved?.content ?? (block.id === firstText ? sections.text.contentJson : []);
      ownSections = { ...sections, text: {
        contentJson,
        content: saved ? extractPlainText(saved.content) : block.id === firstText ? sections.text.content : '',
      } };
    } else if (kind === 'media') {
      ownSections = { ...sections, media: { items: mediaFor(block.id, 'media') } };
    } else if (kind === 'showcase') {
      ownSections = { ...sections, showcase: { items: mediaFor(block.id, 'showcase') } };
    }
    return [{ id: block.id, kind, ...(block.kind === 'image' || block.kind === 'video' ? { mediaKind: block.kind } : {}), sections: ownSections }];
  });
  // Retain readable legacy sections when a partially upgraded server lacks ownership metadata.
  for (const kind of order) {
    if (!entries.some((entry) => entry.kind === kind)) entries.push({ id: `legacy-${kind}`, kind, sections });
  }
  return entries;
}

export function noteMediaBlocks(items: StructuredNoteMediaItem[]): Record<string, unknown>[] {
  return items.filter((item) => Boolean(item.url)).map((item) => ({
    id: item.id ?? item.objectKey ?? item.url,
    type: item.type === 'VIDEO' ? 'video' : item.type === 'AUDIO' ? 'audio' : 'image',
    props: { url: item.url, objectKey: item.objectKey, caption: '', width: item.width ?? undefined,
      height: item.height ?? undefined, durationMs: item.durationMs ?? undefined },
  }));
}
