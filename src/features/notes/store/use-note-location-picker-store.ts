import { create } from 'zustand';

export type PickedNoteLocation = {
  title: string;
  address: string;
  latitude: number;
  longitude: number;
};

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
