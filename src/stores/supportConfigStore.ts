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
  /**
   * 成功 → 返回配置(哪怕五类全空);失败 → 返回 `null` 且清掉缓存。
   * 调用方靠这个区分「后端没配客服」和「这次没拉到」。
   */
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
        // 拉不到就作废缓存(fail closed)。这份配置是「谁是官方客服」的唯一授权源:
        // 管理台撤掉某个客服后,如果刷新失败仍沿用旧列表,那个已被撤销的账号会
        // 继续以官方身份出现在充值/纠纷/账号客服里,用户照样把身份、订单、转账
        // 凭证发过去。宁可空、让用户看到网络错误+重试,也不能把撤销后的账号
        // 一直呈现为官方。调用方据 `null` 区分「拉取失败」与「后端确实没配」。
        guardedSet({ config: null, error: message });
        return null;
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
