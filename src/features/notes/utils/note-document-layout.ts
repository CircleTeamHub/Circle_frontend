import { extractPlainText } from '@/features/notes/utils/note-blocks';
import {
  readNoteComposerBlocks,
  readNoteComposerTextBlocks,
  readNoteComposerMediaBlocks,
  type NoteComposerBlockKind,
} from '@/features/notes/utils/note-composer';
import type { NoteSectionKind, NoteSections, StructuredNoteMediaItem } from './note-sections';

export type NoteDocumentInstance = { id: string; kind: NoteSectionKind; sections: NoteSections };

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
  const blocks = readNoteComposerBlocks(layout);
  const textBlocks = readNoteComposerTextBlocks(layout);
  const mediaBlocks = readNoteComposerMediaBlocks(layout);
  if (!blocks || (!textBlocks.length && !mediaBlocks.length)) {
    return order.map((kind) => ({ id: kind, kind, sections }));
  }
  const firstText = blocks.find((block) => block.kind === 'text')?.id;
  const firstMedia = blocks.find((block) => block.kind === 'image' || block.kind === 'video')?.id;
  const firstShowcase = blocks.find((block) => block.kind === 'showcase')?.id;
  const mediaFor = (id: string, target: 'media' | 'showcase', firstId?: string) => {
    const validOwners = mediaBlocks.filter((owner) => owner.target === target && blocks.some(
      (block) => block.id === owner.id && (target === 'showcase' ? block.kind === 'showcase' : block.kind === 'image' || block.kind === 'video'),
    ));
    const ownKeys = new Set(validOwners.filter((owner) => owner.id === id).flatMap((owner) => owner.objectKeys));
    const assignedKeys = new Set(validOwners.flatMap((owner) => owner.objectKeys));
    return sections[target].items.filter((item) => {
      const key = item.objectKey || item.url || '';
      return ownKeys.has(key) || (id === firstId && !assignedKeys.has(key));
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
      ownSections = { ...sections, media: { items: mediaFor(block.id, 'media', firstMedia) } };
    } else if (kind === 'showcase') {
      ownSections = { ...sections, showcase: { items: mediaFor(block.id, 'showcase', firstShowcase) } };
    }
    return [{ id: block.id, kind, sections: ownSections }];
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
