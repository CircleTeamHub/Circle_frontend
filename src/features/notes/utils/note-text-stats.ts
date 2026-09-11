import { extractPlainText } from '@/features/notes/utils/note-blocks';

type Block = Record<string, unknown>;

// 与后端 CreateNoteDto / NoteTextSectionDto 的校验保持一致。
export const MAX_NOTE_TITLE_LENGTH = 120;
export const MAX_NOTE_TEXT_LENGTH = 20_000;
export const MAX_NOTE_TEXT_BLOCKS = 500;

export type NoteTextStats = {
  /**
   * 后端校验的是拼接后的正文（段落之间补一个换行），所以这里量的也是拼接结果，
   * 而不是用户敲进去的字数 —— 两者差着 (段数 - 1) 个换行。文案跟着说「正文长度」
   * 而不是「已输入字符」，就是为了不在这件事上骗人。
   * 按 code point 计数，与 class-validator 的 Length（validator.js isLength）一致。
   */
  readonly characters: number;
  readonly blocks: number;
};

export const EMPTY_NOTE_TEXT_STATS: NoteTextStats = { characters: 0, blocks: 0 };

export function getNoteTextStats(blocks: readonly Block[]): NoteTextStats {
  return {
    characters: Array.from(extractPlainText(blocks as Block[])).length,
    blocks: blocks.length,
  };
}

export type NoteTextLimitKind = 'textTooLong' | 'tooManyParagraphs';

/** 超出后端限制时返回违反的是哪一条，没超返回 null。 */
export function getNoteTextLimitKind(stats: NoteTextStats): NoteTextLimitKind | null {
  if (stats.characters > MAX_NOTE_TEXT_LENGTH) return 'textTooLong';
  if (stats.blocks > MAX_NOTE_TEXT_BLOCKS) return 'tooManyParagraphs';
  return null;
}

export type NoteTextStatsStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NoteTextStats;
  setBlocks: (blocks: readonly Block[]) => void;
  reset: () => void;
};

/**
 * 正文统计放在编辑器外面的一个小 store 里，而不是 EditNoteScreen 的 state：
 * 每敲一个字都 setState 会把整屏（分组 chip、媒体/展示九宫格、地图预览）重渲染
 * 一遍。订阅这个 store 的只有显示计数和提示的那两处小节点。
 */
export function createNoteTextStatsStore(): NoteTextStatsStore {
  let snapshot: NoteTextStats = EMPTY_NOTE_TEXT_STATS;
  const listeners = new Set<() => void>();

  // 快照不变就不通知：useSyncExternalStore 要求 getSnapshot 在数据没变时返回同一
  // 个引用，否则每次读取都被当成变更，重渲染一个都省不下来。
  const publish = (next: NoteTextStats) => {
    if (next.characters === snapshot.characters && next.blocks === snapshot.blocks) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setBlocks: (blocks) => publish(getNoteTextStats(blocks)),
    reset: () => publish(EMPTY_NOTE_TEXT_STATS),
  };
}
