import { create } from 'zustand';

export interface PendingDeviceVerification {
  id: string;
  expiresAt: string;
  securityCodeAvailable: boolean;
}

// Authentication capabilities stay in memory and never enter URLs or persisted storage.
export const useDeviceVerificationStore = create<{
  challenge: PendingDeviceVerification | null;
  setChallenge: (challenge: PendingDeviceVerification | null) => void;
}>((set) => ({ challenge: null, setChallenge: (challenge) => set({ challenge }) }));
