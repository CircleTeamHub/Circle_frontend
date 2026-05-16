/**
 * api/auth.ts — 认证相关 API
 *
 * - login：账号密码登录，返回 accessToken / refreshToken / imToken
 * - register：注册新账号，返回同上
 * - fetchCurrentUser：用当前 token 获取自身用户信息
 * - fetchCurrentUserWithToken：用指定 token 获取用户信息（登录后立即获取时使用）
 * - logout：使 refreshToken 失效
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiClient } from '@/services/api/client';
import { normalizeUser } from '@/services/api/utils';
import type { DisplayIcon } from '@/types';

// OpenIM platformID: 1=iOS, 2=Android, 5=Web. Backend signs imToken bound to
// this platform; mismatched platform → onUserTokenInvalid on SDK login.
function getOpenIMPlatformID(): 1 | 2 | 5 {
  if (Platform.OS === 'ios') return 1;
  if (Platform.OS === 'android') return 2;
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
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.accessToken !== 'string' || v.accessToken.length === 0) return false;
  if (typeof v.refreshToken !== 'string' || v.refreshToken.length === 0) return false;
  if (v.imToken !== null && typeof v.imToken !== 'undefined' && typeof v.imToken !== 'string') {
    return false;
  }
  return true;
}

function ensureAuthTokens(value: unknown): AuthTokens {
  if (!isAuthTokens(value)) {
    // 字段缺失 / 类型异常 — 视作认证响应损坏，直接抛错而不是带着残缺数据写入 store。
    throw new Error('认证返回数据格式异常，请重试');
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    // 把 undefined / 空字符串归一为 null，方便下游用 `if (tokens.imToken)` 判断。
    imToken:
      typeof value.imToken === 'string' && value.imToken.length > 0
        ? value.imToken
        : null,
  };
}

export type BackendAuthUser = {
  id: string;
  accountId: string;
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
  gender: 'male' | 'female' | 'other' | 'unset';
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
};

type RegisterPayload = {
  accountId: string;
  password: string;
  nickname?: string;
  email?: string;
  phoneNumber?: string;
};

function getDeviceName() {
  return Device.deviceName ?? `circle-im-${Device.osName ?? 'device'}`;
}


export async function login(payload: {
  accountId: string;
  password: string;
}) {
  // accountId 在 API 层兜底 trim：调用方忘记 trim 时也不会因为前导空格被后端拒识
  const accountId = payload.accountId.trim();
  const raw = await apiClient<AuthTokens>('/auth/login', {
    method: 'POST',
    auth: false,
    headers: {
      'x-device-name': getDeviceName(),
    },
    body: { accountId, password: payload.password, platform: getOpenIMPlatformID() },
  });
  return ensureAuthTokens(raw);
}

export async function register(payload: RegisterPayload) {
  const accountId = payload.accountId.trim();
  const raw = await apiClient<AuthTokens>('/auth/register', {
    method: 'POST',
    auth: false,
    headers: {
      'x-device-name': getDeviceName(),
    },
    body: { ...payload, accountId, platform: getOpenIMPlatformID() },
  });
  return ensureAuthTokens(raw);
}

export async function fetchCurrentUser() {
  const user = await apiClient<BackendAuthUser>('/auth/me');
  return normalizeUser(user);
}

export async function fetchCurrentUserWithToken(accessToken: string) {
  const user = await apiClient<BackendAuthUser>('/auth/me', {
    auth: false,
    accessToken,
  });
  return normalizeUser(user);
}

export async function logout(refreshToken: string) {
  return apiClient<void>('/auth/logout', {
    method: 'POST',
    auth: false,
    body: { refreshToken },
  });
}

export async function changePassword(payload: {
  oldPassword: string;
  newPassword: string;
}) {
  return apiClient<void>('/auth/change-password', {
    method: 'POST',
    body: payload,
  });
}

export async function changeAccountId(accountId: string) {
  return apiClient<void>('/auth/account-id', {
    method: 'PATCH',
    body: { accountId },
  });
}

export async function logoutAll() {
  return apiClient<void>('/auth/logout-all', {
    method: 'POST',
  });
}
