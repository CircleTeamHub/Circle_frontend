import { create } from 'zustand';
import type { PickedLocation } from '@/features/location/types';

export type PickedNoteLocation = PickedLocation;

type NoteLocationPickerState = {
  pickedLocation: PickedNoteLocation | null;
  setPickedLocation: (location: PickedNoteLocation) => void;
  consumePickedLocation: () => PickedNoteLocation | null;
};

export const useNoteLocationPickerStore = create<NoteLocationPickerState>((set, get) => ({
  pickedLocation: null,
  setPickedLocation: (pickedLocation) => set({ pickedLocation }),
  consumePickedLocation: () => {
    const current = get().pickedLocation;
    set({ pickedLocation: null });
    return current;
  },
}));
