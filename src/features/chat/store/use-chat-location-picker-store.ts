import { create } from 'zustand';
import type { PickedLocation } from '@/features/location/types';

type ChatLocationPickerState = {
  pickedLocation: PickedLocation | null;
  setPickedLocation: (location: PickedLocation) => void;
  clearPickedLocation: () => void;
  consumePickedLocation: () => PickedLocation | null;
};

export const useChatLocationPickerStore = create<ChatLocationPickerState>((set, get) => ({
  pickedLocation: null,
  setPickedLocation: (pickedLocation) => set({ pickedLocation }),
  clearPickedLocation: () => set({ pickedLocation: null }),
  consumePickedLocation: () => {
    const current = get().pickedLocation;
    set({ pickedLocation: null });
    return current;
  },
}));
