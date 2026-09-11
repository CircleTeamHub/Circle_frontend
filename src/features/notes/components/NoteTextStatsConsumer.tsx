import { useSyncExternalStore, type ReactNode } from 'react';
import type {
  NoteTextStats,
  NoteTextStatsStore,
} from '@/features/notes/utils/note-text-stats';

interface Props {
  store: NoteTextStatsStore;
  children: (stats: NoteTextStats) => ReactNode;
}

/**
 * 把「正文每敲一个字就变一次」的统计关在这一个小组件里：正文变化只重渲染
 * children 返回的那几个节点，外面的编辑页整屏不动。
 */
export function NoteTextStatsConsumer({ store, children }: Props) {
  const stats = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return <>{children(stats)}</>;
}
