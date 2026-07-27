import { create } from 'zustand';
import {
  fetchMembershipProgramStatus,
  type MembershipProgramStatus,
} from '@/services/api/membership';
import { retry } from '@/utils/retry';

type FetchStatusOptions = {
  force?: boolean;
};

interface MembershipProgramState {
  status: MembershipProgramStatus | null;
  loading: boolean;
  error: string | null;
  fetchStatus: (
    options?: FetchStatusOptions,
  ) => Promise<MembershipProgramStatus | null>;
  reset: () => void;
}

let inFlight: Promise<MembershipProgramStatus | null> | null = null;
let runSequence = 0;

export const useMembershipProgramStore = create<MembershipProgramState>(
  (set, get) => ({
    status: null,
    loading: false,
    error: null,

    fetchStatus: (options = {}) => {
      const cached = get().status;
      if (cached && !options.force) {
        return Promise.resolve(cached);
      }
      if (inFlight) {
        return inFlight;
      }

      const runId = ++runSequence;
      const previousStatus = cached;
      const guardedSet: typeof set = (partial) => {
        if (runId === runSequence) {
          set(partial);
        }
      };

      const run = (async () => {
        guardedSet({ loading: true, error: null });
        try {
          const status = await retry(() => fetchMembershipProgramStatus());
          guardedSet({ status, error: null });
          return status;
        } catch (error) {
          const message =
            error &&
            typeof error === 'object' &&
            'message' in error &&
            typeof error.message === 'string'
              ? error.message
              : 'membership program status unavailable';
          guardedSet({
            error: message,
          });
          return previousStatus;
        } finally {
          guardedSet({ loading: false });
        }
      })().finally(() => {
        if (inFlight === run) {
          inFlight = null;
        }
      });

      inFlight = run;
      return run;
    },

    reset: () => {
      runSequence += 1;
      inFlight = null;
      set({ status: null, loading: false, error: null });
    },
  }),
);
