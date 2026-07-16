/**
 * api/auth.ts — 认证相关 API
 *
 * - login：账号密码登录，返回 accessToken / refreshToken / imToken
 * - register：注册新账号，返回同上
 * - fetchCurrentUser：用当前 token 获取自身用户信息
 * - fetchCurrentUserWithToken：用指定 token 获取用户信息（登录后立即获取时使用）
 * - logout：使 refreshToken 失效
 */
import * as Device from "expo-device";
import { Platform } from "react-native";
import { apiClient } from "@/services/api/client";
import { normalizeUser } from "@/services/api/utils";
import type { DisplayIcon } from "@/types";

// OpenIM platformID: 1=iOS, 2=Android, 5=Web. Backend signs imToken bound to
// this platform; mismatched platform → onUserTokenInvalid on SDK login.
function getOpenIMPlatformID(): 1 | 2 | 5 {
  if (Platform.OS === "ios") return 1;
  if (Platform.OS === "android") return 2;
  return 5;
}

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  // 某些账号类型（如管理员、未绑定 IM 的账号）后端可能不签发 imToken。
  // 类型保持与实际响应一致，避免下游做无效的 string 假设。
  imToken: string | null;
};

function isAuthTokens(value: unknown): value is AuthTokens {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.accessToken !== "string" || v.accessToken.length === 0)
    return false;
  if (typeof v.refreshToken !== "string" || v.refreshToken.length === 0)
    return false;
  if (
    v.imToken !== null &&
    typeof v.imToken !== "undefined" &&
    typeof v.imToken !== "string"
  ) {
    return false;
  }
  return true;
}

function ensureAuthTokens(value: unknown): AuthTokens {
  if (!isAuthTokens(value)) {
    // 字段缺失 / 类型异常 — 视作认证响应损坏，直接抛错而不是带着残缺数据写入 store。
    throw new Error("认证返回数据格式异常，请重试");
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    // 把 undefined / 空字符串归一为 null，方便下游用 `if (tokens.imToken)` 判断。
    imToken:
      typeof value.imToken === "string" && value.imToken.length > 0
        ? value.imToken
        : null,
  };
}

export type BackendAuthUser = {
  id: string;
  accountId: string;
  inviteCode: string;
  nickname: string;
  avatarUrl: string | null;
  avatarFrame: string | null;
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

function getDeviceName() {
  return Device.deviceName ?? `circle-im-${Device.osName ?? "device"}`;
}

export async function requestEmailCode(payload: {
  email: string;
  purpose: "register" | "login";
}) {
  return apiClient<void>("/auth/email/request-code", {
    method: "POST",
    auth: false,
    body: {
      email: payload.email.trim().toLowerCase(),
      purpose: payload.purpose,
    },
  });
}

export async function login(payload: { email: string; password: string }) {
  const email = payload.email.trim().toLowerCase();
  const raw = await apiClient<AuthTokens>("/auth/login", {
    method: "POST",
    auth: false,
    headers: {
      "x-device-name": getDeviceName(),
    },
    body: { email, password: payload.password, platform: getOpenIMPlatformID() },
  });
  return ensureAuthTokens(raw);
}

export async function loginWithCode(payload: { email: string; code: string }) {
  const email = payload.email.trim().toLowerCase();
  const raw = await apiClient<AuthTokens>("/auth/login/code", {
    method: "POST",
    auth: false,
    headers: {
      "x-device-name": getDeviceName(),
    },
    body: {
      email,
      code: payload.code.trim(),
      platform: getOpenIMPlatformID(),
    },
  });
  return ensureAuthTokens(raw);
}

export async function register(payload: {
  email: string;
  code: string;
  password: string;
  nickname: string;
  inviteCode?: string;
}) {
  const email = payload.email.trim().toLowerCase();
  const inviteCode = payload.inviteCode?.trim().toLowerCase();
  const raw = await apiClient<AuthTokens>("/auth/register", {
    method: "POST",
    auth: false,
    headers: {
      "x-device-name": getDeviceName(),
    },
    body: {
      email,
      code: payload.code.trim(),
      password: payload.password,
      nickname: payload.nickname.trim(),
      ...(inviteCode ? { inviteCode } : {}),
      platform: getOpenIMPlatformID(),
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
