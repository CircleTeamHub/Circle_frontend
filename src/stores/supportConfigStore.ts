import { create } from 'zustand';
import {
  fetchSupportConfig,
  SUPPORT_CATEGORY_IDS,
  type SupportAgent,
  type SupportCategoryId,
  type SupportConfig,
} from '@/services/api/support';
import { retry } from '@/utils/retry';

type FetchConfigOptions = {
  force?: boolean;
};

interface SupportConfigState {
  config: SupportConfig | null;
  loading: boolean;
  error: string | null;
  fetchConfig: (options?: FetchConfigOptions) => Promise<SupportConfig | null>;
  reset: () => void;
}

let inFlight: Promise<SupportConfig | null> | null = null;
let runSequence = 0;

export const useSupportConfigStore = create<SupportConfigState>((set, get) => ({
  config: null,
  loading: false,
  error: null,

  fetchConfig: (options = {}) => {
    const cached = get().config;
    if (cached && !options.force) {
      return Promise.resolve(cached);
    }
    if (inFlight) {
      return inFlight;
    }

    const runId = ++runSequence;
    const previousConfig = cached;
    const guardedSet: typeof set = (partial) => {
      if (runId === runSequence) {
        set(partial);
      }
    };

    const run = (async () => {
      guardedSet({ loading: true, error: null });
      try {
        const config = await retry(() => fetchSupportConfig());
        guardedSet({ config, error: null });
        return config;
      } catch (error) {
        const message =
          error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string'
            ? error.message
            : 'support config unavailable';
        guardedSet({ error: message });
        return previousConfig;
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
    set({ config: null, loading: false, error: null });
  },
}));

export { SUPPORT_CATEGORY_IDS };
export type { SupportAgent, SupportCategoryId, SupportConfig };
