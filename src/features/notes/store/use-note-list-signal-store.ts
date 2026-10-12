import { create } from 'zustand';

/**
 * Signals that a note was created or changed outside the notes list.
 *
 * The list still reads the authoritative rows from the API; this store only
 * invalidates the screen so a newly collected title is not hidden behind a
 * previously loaded list snapshot.
 */
interface NoteListSignalState {
  version: number;
  bump: () => void;
  reset: () => void;
}

export const useNoteListSignalStore = create<NoteListSignalState>((set) => ({
  version: 0,
  bump: () => set((state) => ({ version: state.version + 1 })),
  reset: () => set({ version: 0 }),
}));
