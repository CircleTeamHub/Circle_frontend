import type { NoteSections } from '@/features/notes/types';

/** The blocks that can be placed in the note composer. */
export type NoteComposerBlockKind =
  | 'title'
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'showcase'
  | 'location'
  | 'contact'
  | 'group';

export type NoteComposerBlock = {
  id: string;
  kind: NoteComposerBlockKind;
};

/**
 * Layout metadata used by the editor.  Unlike the legacy `order` list, the
 * instance list deliberately keeps duplicate kinds: two text blocks and two
 * image blocks are different editable regions and must have stable React
 * keys while they are reordered.
 */
export type NoteComposerBlockInstance = NoteComposerBlock;
export type NoteComposerTextBlock = {
  id: string;
  content: Record<string, unknown>[];
};
export type NoteComposerMediaBlock = {
  id: string;
  target: 'media' | 'showcase';
  objectKeys: string[];
};

export const NOTE_COMPOSER_BLOCK_KINDS: readonly NoteComposerBlockKind[] = [
  'title',
  'text',
  'image',
  'audio',
  'video',
  'showcase',
  'location',
  'contact',
  'group',
];

/**
 * These blocks map to a single field in the note model, so they can only
 * appear once in a composer. Other blocks (for example text and image) are
 * instance based and deliberately keep duplicates.
 */
export const NOTE_COMPOSER_SINGLETON_KINDS: readonly NoteComposerBlockKind[] = [
  'title',
  'location',
  'contact',
  'group',
];

export const DEFAULT_NOTE_COMPOSER_ORDER: readonly NoteComposerBlockKind[] = [
  'title',
  'text',
  'image',
  'audio',
  'video',
  'showcase',
  'location',
  'contact',
  'group',
];

const LAYOUT_BLOCK_TYPE = 'noteLayout';

function isKind(value: unknown): value is NoteComposerBlockKind {
  return typeof value === 'string' && NOTE_COMPOSER_BLOCK_KINDS.includes(value as NoteComposerBlockKind);
}

export function isNoteComposerSingletonKind(kind: NoteComposerBlockKind): boolean {
  return NOTE_COMPOSER_SINGLETON_KINDS.includes(kind);
}

function createLegacyBlockId(kind: NoteComposerBlockKind, index: number) {
  return `${kind}-${index + 1}`;
}

function parseBlockInstance(value: unknown, index: number): NoteComposerBlockInstance | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!isKind(candidate.kind)) return null;
  const id = typeof candidate.id === 'string' && candidate.id.trim()
    ? candidate.id.trim()
    : createLegacyBlockId(candidate.kind, index);
  return { id, kind: candidate.kind };
}

/** Keep repeated editable instances, while collapsing singleton sections. */
function dedupeSingletonBlocks(
  blocks: readonly NoteComposerBlockInstance[],
): NoteComposerBlockInstance[] {
  const seenSingletonKinds = new Set<NoteComposerBlockKind>();
  return blocks.filter((block) => {
    if (!isNoteComposerSingletonKind(block.kind)) return true;
    if (seenSingletonKinds.has(block.kind)) return false;
    seenSingletonKinds.add(block.kind);
    return true;
  });
}

/**
 * Reads instance-aware metadata while accepting the original string `order`
 * format. The old format has no IDs, so deterministic IDs are synthesized to
 * make an existing note editable without changing its persisted data until it
 * is next saved.
 */
export function readNoteComposerBlocks(blocks: unknown): NoteComposerBlockInstance[] | null {
  if (!Array.isArray(blocks)) return null;
  const marker = blocks.find(
    (block) =>
      Boolean(block && typeof block === 'object') &&
      (block as Record<string, unknown>).type === LAYOUT_BLOCK_TYPE,
  ) as Record<string, unknown> | undefined;
  const props = marker?.props;
  if (!props || typeof props !== 'object') return null;
  const metadata = props as Record<string, unknown>;
  const instances = metadata.blocks ?? metadata.instances;
  if (Array.isArray(instances)) {
    const seenIds = new Set<string>();
    const parsed = instances
      .map((value, index) => parseBlockInstance(value, index))
      .filter((value): value is NoteComposerBlockInstance => value !== null)
      .map((value) => {
        let id = value.id;
        let suffix = 2;
        while (seenIds.has(id)) id = `${value.id}-${suffix++}`;
        seenIds.add(id);
        return id === value.id ? value : { ...value, id };
      });
    return parsed.length > 0 ? dedupeSingletonBlocks(parsed) : [];
  }
  if (!Array.isArray(metadata.order)) return null;
  const legacy = metadata.order.filter(isKind);
  return dedupeSingletonBlocks(
    legacy.map((kind, index) => ({ id: createLegacyBlockId(kind, index), kind })),
  );
}

/** Writes both fields so older readers can still derive a useful layout. */
export function buildNoteComposerBlocksMetadata(
  blocks: readonly NoteComposerBlockInstance[],
  textBlocks?: readonly NoteComposerTextBlock[],
  mediaBlocks?: readonly NoteComposerMediaBlock[],
) {
  return {
    type: LAYOUT_BLOCK_TYPE,
    props: {
      order: blocks.map(({ kind }) => kind),
      blocks: blocks.map(({ id, kind }) => ({ id, kind })),
      ...(textBlocks ? { textBlocks } : {}),
      ...(mediaBlocks ? { mediaBlocks } : {}),
    },
  } as Record<string, unknown>;
}

export function readNoteComposerMediaBlocks(blocks: unknown): NoteComposerMediaBlock[] {
  if (!Array.isArray(blocks)) return [];
  const marker = blocks.find(
    (block) =>
      Boolean(block && typeof block === 'object') &&
      (block as Record<string, unknown>).type === LAYOUT_BLOCK_TYPE,
  ) as Record<string, unknown> | undefined;
  const props = marker?.props;
  if (!props || typeof props !== 'object') return [];
  const mediaBlocks = (props as Record<string, unknown>).mediaBlocks;
  if (!Array.isArray(mediaBlocks)) return [];
  return mediaBlocks.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      (item.target !== 'media' && item.target !== 'showcase') ||
      !Array.isArray(item.objectKeys)
    ) return [];
    return [{
      id: item.id,
      target: item.target,
      objectKeys: item.objectKeys.filter((key): key is string => typeof key === 'string'),
    }];
  });
}

/** Reads the per-instance rich text payload written by the editor. */
export function readNoteComposerTextBlocks(blocks: unknown): NoteComposerTextBlock[] {
  if (!Array.isArray(blocks)) return [];
  const marker = blocks.find(
    (block) =>
      Boolean(block && typeof block === 'object') &&
      (block as Record<string, unknown>).type === LAYOUT_BLOCK_TYPE,
  ) as Record<string, unknown> | undefined;
  const props = marker?.props;
  if (!props || typeof props !== 'object') return [];
  const textBlocks = (props as Record<string, unknown>).textBlocks;
  if (!Array.isArray(textBlocks)) return [];
  return textBlocks.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !Array.isArray(item.content)) return [];
    return [{ id: item.id, content: item.content as Record<string, unknown>[] }];
  });
}

/**
 * Normalizes an instance list for an existing note. Existing duplicate
 * instances are retained in place; only missing kinds required by available
 * legacy sections are appended. This mirrors normalizeNoteComposerOrder while
 * keeping IDs and therefore works as a drop-in migration for the editor.
 */
export function normalizeNoteComposerBlocks(
  blocks: readonly NoteComposerBlockInstance[] | null | undefined,
  sections: Partial<NoteSections> | null | undefined,
  hasTitle = true,
): NoteComposerBlockInstance[] {
  const seenIds = new Set<string>();
  const seenSingletonKinds = new Set<NoteComposerBlockKind>();
  const next = (blocks ?? []).flatMap((block, index) => {
    if (!isKind(block?.kind)) return [];
    if (isNoteComposerSingletonKind(block.kind)) {
      if (seenSingletonKinds.has(block.kind)) return [];
      seenSingletonKinds.add(block.kind);
    }
    let id = typeof block.id === 'string' && block.id.trim()
      ? block.id.trim()
      : createLegacyBlockId(block.kind, index);
    let suffix = 2;
    while (seenIds.has(id)) id = `${id}-${suffix++}`;
    seenIds.add(id);
    return [{ id, kind: block.kind }];
  });

  const hasMedia = Boolean(sections && 'media' in sections);
  const hasShowcase = Boolean(sections && 'showcase' in sections);
  const hasAudio = Boolean(sections && 'audio' in sections);
  const hasContacts = Boolean(sections && 'contacts' in sections);
  const hasGroups = Boolean(sections && 'groups' in sections);
  const hasLocation = Boolean(sections && 'location' in sections);
  const required: NoteComposerBlockKind[] = [
    ...(hasTitle ? ['title' as const] : []),
    ...(sections?.text ? ['text' as const] : []),
    ...(hasMedia ? ['image' as const] : []),
    ...(hasShowcase ? ['showcase' as const] : []),
    ...(hasAudio ? ['audio' as const] : []),
    ...(hasLocation ? ['location' as const] : []),
    ...(hasContacts ? ['contact' as const] : []),
    ...(hasGroups ? ['group' as const] : []),
  ];
  for (const kind of required) {
    if (next.some((block) => block.kind === kind)) continue;
    let id = createLegacyBlockId(kind, next.length);
    let suffix = 2;
    while (seenIds.has(id)) id = `${kind}-${next.length + 1}-${suffix++}`;
    seenIds.add(id);
    next.push({ id, kind });
  }
  return next.length ? next : [{ id: 'title-1', kind: 'title' }, { id: 'text-1', kind: 'text' }];
}

/** Extracts the persisted order marker without exposing it to BlockNote. */
export function readNoteComposerOrder(blocks: unknown): NoteComposerBlockKind[] | null {
  if (!Array.isArray(blocks)) return null;
  const marker = blocks.find(
    (block) =>
      Boolean(block && typeof block === 'object') &&
      (block as Record<string, unknown>).type === LAYOUT_BLOCK_TYPE,
  ) as Record<string, unknown> | undefined;
  const props = marker?.props;
  const order = props && typeof props === 'object' ? (props as Record<string, unknown>).order : null;
  if (!Array.isArray(order)) return null;
  return [...new Set(order.filter(isKind))];
}

/** Removes the private layout marker before giving blocks to BlockNote. */
export function stripNoteComposerMetadata<T>(blocks: readonly T[]): T[] {
  return blocks.filter(
    (block) =>
      !(
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === LAYOUT_BLOCK_TYPE
      ),
  );
}

/** Appends new data sections while keeping a user's saved order stable. */
export function normalizeNoteComposerOrder(
  order: readonly NoteComposerBlockKind[] | null | undefined,
  sections: Partial<NoteSections> | null | undefined,
  hasTitle = true,
): NoteComposerBlockKind[] {
  const next = [...new Set((order ?? []).filter(isKind))];
  // An editor must keep empty sections available so the user can add content
  // after loading a new or previously empty note. Detail screens filter these
  // entries against their actual availability before rendering them.
  const hasMedia = Boolean(sections && 'media' in sections);
  const hasShowcase = Boolean(sections && 'showcase' in sections);
  const hasAudio = Boolean(sections && 'audio' in sections);
  const hasContacts = Boolean(sections && 'contacts' in sections);
  const hasGroups = Boolean(sections && 'groups' in sections);
  const hasLocation = Boolean(sections && 'location' in sections);
  const required: NoteComposerBlockKind[] = [
    ...(hasTitle ? ['title' as const] : []),
    ...(sections?.text ? ['text' as const] : []),
    ...(hasMedia ? ['image' as const] : []),
    ...(hasShowcase ? ['showcase' as const] : []),
    ...(hasAudio ? ['audio' as const] : []),
    ...(hasLocation ? ['location' as const] : []),
    ...(hasContacts ? ['contact' as const] : []),
    ...(hasGroups ? ['group' as const] : []),
  ];
  for (const kind of required) {
    if (!next.includes(kind)) next.push(kind);
  }
  return next.length ? next : ['title', 'text'];
}

export function buildNoteComposerMetadata(order: readonly NoteComposerBlockKind[]) {
  return {
    type: LAYOUT_BLOCK_TYPE,
    props: { order: [...order] },
  } as Record<string, unknown>;
}
