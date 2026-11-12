import { create } from 'zustand';
import type { NoteRatingCounts } from '@/services/api/note-ratings';

/**
 * This month's rating counters for chat note cards, keyed by the card's noteId.
 *
 * Chat cards are message snapshots, so the counters come from the batched
 * `POST /note/source-states` reconciliation that already runs when a
 * conversation opens or reconnects (use-note-card-status-sync). Counters are
 * public, so the in-memory map needs no per-account reset.
 */
interface NoteRatingCountsState {
  counts: Record<string, NoteRatingCounts>;
  record: (
    rows: readonly { noteId: string; goodCount?: number; badCount?: number }[],
  ) => void;
}

export const useNoteRatingCountsStore = create<NoteRatingCountsState>((set) => ({
  counts: {},
  record: (rows) => {
    const known = rows.filter(
      (row) => typeof row.goodCount === 'number' && typeof row.badCount === 'number',
    );
    if (known.length === 0) return;
    set((state) => {
      const counts = { ...state.counts };
      for (const row of known) {
        counts[row.noteId] = { goodCount: row.goodCount!, badCount: row.badCount! };
      }
      return { counts };
    });
  },
}));
