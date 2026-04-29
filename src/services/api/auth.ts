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
import { apiClient } from '@/services/api/client';
import { normalizeUser } from '@/services/api/utils';
import type { DisplayIcon } from '@/types';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  imToken: string;
};

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
  return apiClient<AuthTokens>('/auth/login', {
    method: 'POST',
    auth: false,
    headers: {
      'x-device-name': getDeviceName(),
    },
    body: payload,
  });
}

export async function register(payload: RegisterPayload) {
  return apiClient<AuthTokens>('/auth/register', {
    method: 'POST',
    auth: false,
    headers: {
      'x-device-name': getDeviceName(),
    },
    body: payload,
  });
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
