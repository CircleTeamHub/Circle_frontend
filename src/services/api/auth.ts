/**
 * api/auth.ts — 认证相关 API
 *
 * - login：账号密码登录，返回 accessToken / refreshToken
 * - register：注册新账号，返回同上
 * - fetchCurrentUser：用当前 token 获取自身用户信息
 * - fetchCurrentUserWithToken：用指定 token 获取用户信息（登录后立即获取时使用）
 * - logout：使 refreshToken 失效
 */
import * as Device from "expo-device";
import { apiClient, refreshSessionAccessToken } from "@/services/api/client";
import { normalizeUser } from "@/services/api/utils";
import type { AvatarFrameAppearance, DisplayIcon } from "@/types";
import { UserFacingError } from "@/utils/user-facing-error";

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

function isAuthTokens(value: unknown): value is AuthTokens {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.accessToken !== "string" || v.accessToken.length === 0)
    return false;
  if (typeof v.refreshToken !== "string" || v.refreshToken.length === 0)
    return false;
  return true;
}

function ensureAuthTokens(value: unknown): AuthTokens {
  if (!isAuthTokens(value)) {
    // 字段缺失 / 类型异常 — 视作认证响应损坏，直接抛错而不是带着残缺数据写入 store。
    throw new UserFacingError("认证返回数据格式异常，请重试");
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
  };
}

export type BackendAuthUser = {
  id: string;
  accountId: string;
  inviteCode: string;
  nickname: string;
  avatarUrl: string | null;
  avatarFrame?: string | null;
  avatarFrameAppearance?: AvatarFrameAppearance | null;
  cover: string | null;
  email: string | null;
  phoneNumber: string | null;
  wechat: string | null;
  qq: string | null;
  whatsup: string | null;
  persona: string | null;
  helloWords: string | null;
  birthday: string | null;
  gender: "male" | "female" | "other" | "unset";
  city: string | null;
  vipLevel: number;
  creditScore: number;
  fancyNumber: boolean;
  displayIcons: DisplayIcon[];
  role: string;
  status: string;
  lastOnline: string | null;
  createdAt: string;
  updatedAt: string;
  receivedLikeCount?: number;
  likeCount?: number;
  recognitionCount?: number;
};

// 会话管理列表里用来区分设备的展示名。用 modelName（"iPhone 15 Pro"）而不是
// deviceName —— 后者在 iOS 上是用户自命名（"Alice 的 iPhone"），是实名 PII，
// 会被后端持久化并从 GET /auth/sessions 原样吐回（#98）。
function getDeviceName() {
  return Device.modelName ?? `circle-im-${Device.osName ?? "device"}`;
}

/** 密码正确但设备陌生：服务端不发 token，只给一个待受信任设备批准的验证单。 */
export type LoginChallenge = {
  id: string;
  expiresAt: string;
  securityCodeAvailable: boolean;
  /** 已申请找回时，等待期结束的时间（之后在这台设备上用密码登录即可）；没申请为 null。 */
  recoveryAvailableAt: string | null;
};

export type LoginResult =
  | { kind: "tokens"; tokens: AuthTokens }
  | { kind: "deviceVerification"; challenge: LoginChallenge };

function parseLoginChallenge(value: unknown): LoginChallenge | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.deviceVerificationRequired !== true) return null;
  const challenge = v.challenge as Record<string, unknown> | undefined;
  if (
    !challenge ||
    typeof challenge.id !== "string" ||
    typeof challenge.expiresAt !== "string"
  ) {
    throw new UserFacingError("认证返回数据格式异常，请重试");
  }
  return {
    id: challenge.id,
    expiresAt: challenge.expiresAt,
    securityCodeAvailable: challenge.securityCodeAvailable === true,
    recoveryAvailableAt:
      typeof challenge.recoveryAvailableAt === "string"
        ? challenge.recoveryAvailableAt
        : null,
  };
}

export async function login(
  payload: { identifier: string; password: string },
): Promise<LoginResult> {
  const identifier = payload.identifier.trim();
  const raw = await apiClient<unknown>("/auth/login", {
    method: "POST",
    auth: false,
    headers: {
      "x-device-name": getDeviceName(),
    },
    body: {
      identifier,
      password: payload.password,
      // 不再上报 platform:它是旧 IM 时代的平台码,服务端从未写进登录会话(设备名走
      // x-device-name 头)。已装机旧版本仍会发,后端继续接受。
    },
  });
  const challenge = parseLoginChallenge(raw);
  if (challenge) return { kind: "deviceVerification", challenge };
  return { kind: "tokens", tokens: ensureAuthTokens(raw) };
}

export type LoginChallengeStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CONSUMED";

/** 新设备轮询：受信任设备是否已点同意 / 拒绝。 */
export async function fetchLoginChallengeStatus(challengeId: string) {
  return apiClient<{
    status: LoginChallengeStatus;
    expiresAt: string;
    codeExpiresAt: string | null;
    recoveryAvailableAt?: string | null;
  }>(`/auth/login-challenges/${encodeURIComponent(challengeId)}/status`, {
    method: "GET",
    auth: false,
  });
}

/** 新设备：输入受信任设备上显示的 6 位验证码，通过即拿到 token。 */
export async function verifyLoginChallengeCode(
  challengeId: string,
  code: string,
) {
  const raw = await apiClient<AuthTokens>(
    `/auth/login-challenges/${encodeURIComponent(challengeId)}/verify`,
    {
      method: "POST",
      auth: false,
      headers: { "x-device-name": getDeviceName() },
      body: { code },
    },
  );
  return ensureAuthTokens(raw);
}

/** 新设备：受信任设备不在身边时改用登录安全码。 */
export async function verifyLoginChallengeSecurityCode(
  challengeId: string,
  securityCode: string,
) {
  const raw = await apiClient<AuthTokens>(
    `/auth/login-challenges/${encodeURIComponent(challengeId)}/security-code`,
    {
      method: "POST",
      auth: false,
      headers: { "x-device-name": getDeviceName() },
      body: { securityCode },
    },
  );
  return ensureAuthTokens(raw);
}

/** 新设备：验证请求过期后重新发起（服务端沿用原设备信息，计入频率限制）。 */
export async function resendLoginChallenge(challengeId: string) {
  const raw = await apiClient<unknown>(
    `/auth/login-challenges/${encodeURIComponent(challengeId)}/resend`,
    { method: "POST", auth: false },
  );
  const challenge = parseLoginChallenge(raw);
  if (!challenge) throw new UserFacingError("认证返回数据格式异常，请重试");
  return challenge;
}

/**
 * 新设备：受信任设备全都用不了（原来的手机重装 / 丢失 / 恢复出厂）时申请找回。
 * 等待期后在这台设备上用密码登录即可；期间受信任设备会收到提醒并能拒绝。
 */
export async function requestLoginRecovery(challengeId: string) {
  const raw = await apiClient<unknown>(
    `/auth/login-challenges/${encodeURIComponent(challengeId)}/recovery`,
    { method: "POST", auth: false },
  );
  const challenge = parseLoginChallenge(raw);
  if (!challenge || !challenge.recoveryAvailableAt || !Number.isFinite(Date.parse(challenge.recoveryAvailableAt))) throw new UserFacingError("认证返回数据格式异常，请重试");
  return challenge;
}

export type PendingLoginChallenge = {
  id: string;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  status: "PENDING" | "APPROVED";
  /** 这是一条找回申请：不处理的话到这个时间后对方就能登录。 */
  recoveryAvailableAt?: string | null;
};

/** 受信任设备：待处理的陌生设备登录请求。 */
/**
 * 功能上线前登录的会话还没绑定设备，批准相关接口会回 AUTH_SESSION_DEVICE_UNBOUND。
 * 这时用 refresh token 续签一次（续签时服务端绑定本机设备并记为受信任），再重试
 * 一次。不走 401：apiClient 在「续签后仍 401」时会清会话登出，这里续签没绑上也
 * 只是本次失败，不能把人踢下线。
 */
async function withDeviceBoundSession<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
    if (errorCode !== "AUTH_SESSION_DEVICE_UNBOUND") throw error;
    await refreshSessionAccessToken();
    return request();
  }
}

export async function fetchPendingLoginChallenges() {
  return withDeviceBoundSession(() =>
    apiClient<PendingLoginChallenge[]>("/auth/login-challenges", {
      method: "GET",
    }),
  );
}

/** 受信任设备：确认是本人，拿到 60 秒有效的验证码。 */
export async function approveLoginChallenge(challengeId: string) {
  return withDeviceBoundSession(() =>
    apiClient<{ code: string; codeExpiresAt: string }>(
      `/auth/login-challenges/${encodeURIComponent(challengeId)}/approve`,
      { method: "POST" },
    ),
  );
}

/** 受信任设备：不是本人，拒绝这次登录。 */
export async function rejectLoginChallenge(challengeId: string) {
  return withDeviceBoundSession(() =>
    apiClient<void>(
      `/auth/login-challenges/${encodeURIComponent(challengeId)}/reject`,
      { method: "POST" },
    ),
  );
}

export async function register(payload: {
  email: string;
  password: string;
  confirmPassword: string;
  nickname: string;
  inviteCode?: string;
}) {
  const email = payload.email.trim().toLowerCase();
  const inviteCode = payload.inviteCode?.trim().toUpperCase();
  const raw = await apiClient<AuthTokens>("/auth/register", {
    method: "POST",
    auth: false,
    headers: {
      "x-device-name": getDeviceName(),
    },
    body: {
      email,
      password: payload.password,
      confirmPassword: payload.confirmPassword,
      nickname: payload.nickname.trim(),
      ...(inviteCode ? { inviteCode } : {}),
    },
  });
  return ensureAuthTokens(raw);
}


export async function fetchCurrentUser() {
  const user = await apiClient<BackendAuthUser>("/auth/me");
  return normalizeUser(user);
}

export async function fetchCurrentUserWithToken(accessToken: string) {
  const user = await apiClient<BackendAuthUser>("/auth/me", {
    auth: false,
    accessToken,
  });
  return normalizeUser(user);
}

export async function logout(refreshToken: string) {
  return apiClient<void>("/auth/logout", {
    method: "POST",
    auth: false,
    body: { refreshToken },
  });
}

/** FE#92 忘记密码：请求重置验证码（未注册邮箱后端静默成功，防枚举）。 */
export async function requestPasswordReset(email: string) {
  return apiClient<void>("/auth/password/reset-request", {
    method: "POST",
    auth: false,
    body: { email: email.trim().toLowerCase() },
  });
}

/** FE#92 忘记密码：验证码换新密码（成功后后端撤销全部会话）。 */
export async function resetPassword(payload: {
  email: string;
  code: string;
  newPassword: string;
}) {
  return apiClient<void>("/auth/password/reset", {
    method: "POST",
    auth: false,
    body: {
      email: payload.email.trim().toLowerCase(),
      code: payload.code.trim(),
      newPassword: payload.newPassword,
    },
  });
}

export async function changePassword(payload: {
  oldPassword: string;
  newPassword: string;
}) {
  return apiClient<void>("/auth/change-password", {
    method: "POST",
    body: payload,
  });
}

export type LoginSecurityCodeStatus = {
  enabled: boolean;
};

export async function fetchLoginSecurityCodeStatus() {
  return apiClient<LoginSecurityCodeStatus>("/auth/security-code", {
    method: "GET",
  });
}

export async function setLoginSecurityCode(payload: {
  securityCode: string;
  oldSecurityCode?: string;
}) {
  return apiClient<void>("/auth/security-code", {
    method: "PUT",
    body: payload,
  });
}

export async function disableLoginSecurityCode(securityCode: string) {
  return apiClient<void>("/auth/security-code", {
    method: "DELETE",
    body: { securityCode },
  });
}

export async function verifyLoginSecurityCode(securityCode: string) {
  return apiClient<{ ok: boolean }>("/auth/security-code/verify", {
    method: "POST",
    body: { securityCode },
  });
}

export async function logoutAll() {
  return apiClient<void>("/auth/logout-all", {
    method: "POST",
  });
}

export type AuthSession = {
  id: string;
  isCurrent: boolean;
  trustedOnly?: boolean;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiredAt: string;
};

export async function fetchAuthSessions() {
  return apiClient<AuthSession[]>("/auth/sessions", {
    method: "GET",
  });
}

export async function revokeAuthSession(sessionId: string) {
  return apiClient<void>(`/auth/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export async function logoutOtherSessions() {
  return apiClient<void>("/auth/logout-others", {
    method: "POST",
  });
}

export type SingleDeviceLoginStatus = {
  enabled: boolean;
};

export async function fetchSingleDeviceLoginStatus() {
  return apiClient<SingleDeviceLoginStatus>("/auth/single-device-login", {
    method: "GET",
  });
}

export async function setSingleDeviceLogin(enabled: boolean) {
  return apiClient<void>("/auth/single-device-login", {
    method: "PUT",
    body: { enabled },
  });
}
