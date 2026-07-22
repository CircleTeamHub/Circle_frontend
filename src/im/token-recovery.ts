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

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

type IMLoginExecutor = (userId: string, imToken: string) => Promise<boolean>;
type IMLogoutExecutor = () => Promise<void>;

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

export function isIMReloginPending(): boolean {
  return reloginPending;
}

async function performRecovery(): Promise<boolean> {
  const {
    user,
    accessToken,
    onboardingRequired,
    sessionEpoch: startEpoch,
  } = useAuthStore.getState();

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
      const epochStillCurrent =
        useAuthStore.getState().sessionEpoch === startEpoch;
      if (epochStillCurrent) {
        useIMStore.getState().setError(
          i18n.t('common.errors.sessionExpired', {
            defaultValue: '登录已过期，请重新登录',
          }),
        );
      }
      await clearLocalSession(startEpoch);
      if (epochStillCurrent) {
        router.replace('/(auth)/login');
      }
      return false;
    }
    // 网络不可达 / 503 / 限流：会话保住，记欠账，回前台再试。
    reloginPending = true;
    if (isDev) {
      console.warn(
        '[openim] im-token refresh failed; will retry on next foreground',
        error instanceof Error ? error.message : error,
      );
    }
    return false;
  }

  // 恢复期间用户登出 / 切号：这枚 token 属于旧会话，丢弃。
  if (useAuthStore.getState().sessionEpoch !== startEpoch) {
    reloginPending = false;
    return false;
  }

  useAuthStore.getState().setImToken(imToken);

  if (!imLoginExecutor) {
    // client.ts 未被求值（理论上不可能：listeners 由它绑定）。记欠账兜底。
    reloginPending = true;
    return false;
  }

  try {
    const loggedIn = await imLoginExecutor(user.id, imToken);
    // review 修复：executor await 期间用户可能已登出/切号 —— 此时刚完成的是
    // 「旧用户」的 OpenIM 登录，放着不管消息会路由到错误身份下。拆掉并按
    // 失败返回（新会话的 IM 登录由它自己的启动流程负责）。
    if (useAuthStore.getState().sessionEpoch !== startEpoch) {
      if (loggedIn && imLogoutExecutor) {
        await imLogoutExecutor().catch(() => undefined);
      }
      reloginPending = false;
      return false;
    }
    reloginPending = !loggedIn;
    return loggedIn;
  } catch (error) {
    reloginPending = true;
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
