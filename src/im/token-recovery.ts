/**
 * im/token-recovery.ts — IM 凭证失效的原地自愈
 *
 * 背景（#83 / #85）：imToken 过期或缺失时，旧行为是把整个业务会话清掉跳登录页，
 * 而业务 refreshToken 明明还有效。本模块用业务凭证向 GET /auth/im-token 换一枚
 * 新 IM token 并原地重登 OpenIM，只有业务凭证也被服务端明确拒绝时才走真正的登出。
 *
 * 模块边界：
 * - 不 import im/client.ts（client → listeners → 本模块，反向引会成环）。
 *   真正执行 OpenIM 登录的函数由 client.ts 在模块求值时通过
 *   registerIMLoginExecutor 注入。
 * - 失败分类完全复用 api 层语义：isDefinitiveAuthFailure 判「服务端明确否认凭证」；
 *   403 是 im-token 端点对 ADMIN audience 的拒发（不是会话死亡信号），单独处理。
 *
 * 后端契约（circle_be src/auth/auth.controller.ts GET /auth/im-token）：
 * - JWT 保护，10 次/分钟限流；
 * - OpenIM 不可用时返回 503 而不是空 token —— 所以空响应视为异常；
 * - ADMIN audience 恒 403（管理台会话不发 IM 凭证）。
 */
import { router } from 'expo-router';
import i18n from '@/i18n';
import { fetchImToken } from '@/services/api/auth';
import { isDefinitiveAuthFailure } from '@/services/api/client';
import { clearLocalSession } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useIMStore } from '@/stores/imStore';
import { useKnownAccountsStore } from '@/stores/knownAccountsStore';
import { toImUserId } from '@/im/user-id';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

type IMLoginExecutor = (userId: string, imToken: string) => Promise<boolean>;
type IMLogoutExecutor = (options?: { forceNative?: boolean }) => Promise<void>;

let imLoginExecutor: IMLoginExecutor | null = null;
let imLogoutExecutor: IMLogoutExecutor | null = null;

/** 由 im/client.ts 在模块求值时注入 loginToOpenIM，避免模块环。 */
export function registerIMLoginExecutor(executor: IMLoginExecutor): void {
  imLoginExecutor = executor;
}

/** 同上：注入 logoutFromOpenIM，供「恢复期间会话已切换」的陈旧登录拆除。 */
export function registerIMLogoutExecutor(executor: IMLogoutExecutor): void {
  imLogoutExecutor = executor;
}

// 单飞：SDK 可能连发 onUserTokenExpired / onUserTokenInvalid，服务端限流 10 次/分，
// 并发恢复既浪费配额也可能触发重复登录。
// review 修复：单飞按 sessionEpoch 记账 —— A 会话的在飞恢复不能被 B 会话
// 复用（A 的 epoch 守卫会让它 no-op 返回 false，B 将永远拿不到自己的恢复）。
let recoveryPromise: Promise<boolean> | null = null;
let recoveryEpoch: number | null = null;
// 「欠一次恢复」标记：瞬时失败（网络 / 503 / 限流）后置 true，
// SessionBootstrap 的回前台监听会消费它再试一次。
let reloginPending = false;
// 恢复代次：多端顶替被踢下线时 bump，让在飞的 performRecovery 收尾时自我作废、
// 不再重登。踢下线**不改** sessionEpoch（业务会话仍有效），故 epoch 守卫拦不住，单列此代次。
let recoveryGeneration = 0;

export function isIMReloginPending(): boolean {
  return reloginPending;
}

/**
 * 取消当前会话的 IM 恢复：清「欠一次恢复」标记 + 作废在飞的 recoverIMSession（bump 代次）。
 * 用于同账号在另一端顶替登录把本端踢下线——绝不能自动换 token 重登，否则会把顶替的新设备
 * 再踢下线，两端互踢成风暴。之后用户如需可自行重新进入触发一次全新的登录。
 */
export function cancelIMSessionRecovery(): void {
  reloginPending = false;
  recoveryGeneration += 1;
}

async function performRecovery(): Promise<boolean> {
  const {
    user,
    accessToken,
    onboardingRequired,
    sessionEpoch: startEpoch,
  } = useAuthStore.getState();

  // 恢复期间若被踢下线（cancelIMSessionRecovery 会 bump 代次），一律不再 re-arm 欠账——
  // 否则回前台又会重登、把顶替的新设备踢下线。置 false 永远安全（取消本就想清欠账）。
  const startGeneration = recoveryGeneration;
  const armReloginDebt = (value: boolean) => {
    reloginPending = recoveryGeneration === startGeneration ? value : false;
  };

  // 没有业务会话 / onboarding 未完成：成功路径本就不登录 IM，这里保持同一门禁。
  if (!accessToken || !user || onboardingRequired) {
    reloginPending = false;
    return false;
  }

  let imToken: string;
  try {
    imToken = await fetchImToken();
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 403) {
      // 端点明确拒发（ADMIN audience 等）：本会话不会有 IM，可用重试也换不来，
      // 不记欠账也不登出。
      reloginPending = false;
      return false;
    }
    if (isDefinitiveAuthFailure(error)) {
      // 业务凭证也被服务端明确否认（401 且 refresh 已在 api 层失败）——
      // 这才是真正的「请重新登录」。clearLocalSession 幂等，api 层可能已清过。
      // review 修复：清理与跳转都锚定 startEpoch —— 请求 unwinding 期间用户
      // 已重新登录/切号时，无作用域的 clear 会把新会话也抹掉再踢回登录页。
      reloginPending = false;
      if (useAuthStore.getState().sessionEpoch === startEpoch) {
        useIMStore.getState().setError(
          i18n.t('common.errors.sessionExpired', {
            defaultValue: '登录已过期，请重新登录',
          }),
        );
      }
      await clearLocalSession(startEpoch);
      // round 2 review：路由决策在 clearLocalSession 的 await **之后**重读
      // epoch —— 清理执行期间用户可能已重新登录（epoch 前进，clear 对新会话
      // no-op），拿 await 前缓存的布尔去 replace 会把有效新会话踢回登录页。
      if (useAuthStore.getState().sessionEpoch === startEpoch) {
        router.replace('/(auth)/login');
      }
      return false;
    }
    // 网络不可达 / 503 / 限流：会话保住，记欠账，回前台再试。
    armReloginDebt(true);
    if (isDev) {
      console.warn(
        '[openim] im-token refresh failed; will retry on next foreground',
        error instanceof Error ? error.message : error,
      );
    }
    return false;
  }

  // 恢复期间用户登出 / 切号：这枚 token 属于旧会话，丢弃。
  // round 3 review：不动 reloginPending —— 它此刻可能是 B 会话刚记下的
  // 欠账（B 的瞬时失败），A 的迟到收尾清掉它会让 B 的前台重试被跳过。
  if (useAuthStore.getState().sessionEpoch !== startEpoch) {
    return false;
  }

  useAuthStore.getState().setImToken(imToken);
  // round 2 review：新 imToken 同步进快速切号的账号列表 —— 否则切走再切回
  // 会用 account.imToken 里那枚已被拒绝的旧 token 登 IM，失败路径只 warn
  // 不再恢复，聊天断连到冷启动。仅在该账号已在列表且业务凭证齐备时写。
  const authNow = useAuthStore.getState();
  if (authNow.accessToken && authNow.refreshToken && authNow.user) {
    const known = useKnownAccountsStore
      .getState()
      .accounts.find((account) => account.user.id === user.id);
    if (known) {
      useKnownAccountsStore.getState().upsertAccount({
        ...known,
        accessToken: authNow.accessToken,
        refreshToken: authNow.refreshToken,
        imToken,
        updatedAt: Date.now(),
      });
    }
  }

  if (!imLoginExecutor) {
    // client.ts 未被求值（理论上不可能：listeners 由它绑定）。记欠账兜底。
    armReloginDebt(true);
    return false;
  }

  // 恢复期间被踢下线（cancelIMSessionRecovery bump 了代次）：到这一步就别再重登了，
  // 否则会把顶替本端的新设备再踢下线。
  if (recoveryGeneration !== startGeneration) {
    return false;
  }

  try {
    const loggedIn = await imLoginExecutor(user.id, imToken);
    // review 修复：executor await 期间用户可能已登出/切号 —— 此时刚完成的是
    // 「旧用户」的 OpenIM 登录，放着不管消息会路由到错误身份下。拆掉并按
    // 失败返回（新会话的 IM 登录由它自己的启动流程负责）。
    if (useAuthStore.getState().sessionEpoch !== startEpoch) {
      // round 2 review：拆除范围限定「SDK 仍连着旧用户」——B 会话若已完成
      // 自己的 IM 登录，无差别 logout 会把刚建好的新会话一并拆掉。
      // currentUserID 是 IM 侧 id（toImUserId 归一），与旧用户比对后再动手。
      const currentImUser = useIMStore.getState().currentUserID;
      const staleImUser = toImUserId(user.id);
      if (loggedIn && imLogoutExecutor && currentImUser === staleImUser) {
        // round 3：强制原生登出 —— 普通 logout 在 connected 尚未翻真时会
        // 跳过 SDK.logout 只清本地态，native 侧仍以旧用户登录着，B 随后
        // 会撞上 Logged 状态复用错误会话。
        await imLogoutExecutor({ forceNative: true }).catch(() => undefined);
      }
      // round 3：欠账不动（可能属于 B 会话）。
      return false;
    }
    armReloginDebt(!loggedIn);
    return loggedIn;
  } catch (error) {
    armReloginDebt(true);
    if (isDev) {
      console.warn(
        '[openim] re-login with fresh im-token failed; will retry on next foreground',
        error instanceof Error ? error.message : error,
      );
    }
    return false;
  }
}

/**
 * 用业务凭证换新 IM token 并原地重登。返回是否恢复成功。
 * 幂等且单飞；所有失败都被内部消化（终局失败会清 session 跳登录页，
 * 瞬时失败记欠账），调用方无需 catch。
 */
export function recoverIMSession(): Promise<boolean> {
  const currentEpoch = useAuthStore.getState().sessionEpoch;
  if (recoveryPromise && recoveryEpoch === currentEpoch) {
    return recoveryPromise;
  }
  // 换会话后旧在飞恢复照旧收尾（其 epoch 守卫会让它 no-op），当前会话另起一次。
  const active = performRecovery().finally(() => {
    if (recoveryPromise === active) {
      recoveryPromise = null;
      recoveryEpoch = null;
    }
  });
  recoveryPromise = active;
  recoveryEpoch = currentEpoch;
  return active;
}
