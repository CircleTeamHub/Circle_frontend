import { API_URL } from '@/constants/config';
import { apiClient } from '@/services/api/client';

export type GeocoderFetchResponse = Pick<Response, 'ok' | 'json'>;
export type GeocoderFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<GeocoderFetchResponse>;

function apiEndpointFor(url: URL): string | null {
  try {
    const api = new URL(API_URL);
    const apiPath = api.pathname.replace(/\/+$/, '');
    if (url.origin !== api.origin) return null;
    if (apiPath && url.pathname !== apiPath && !url.pathname.startsWith(`${apiPath}/`)) {
      return null;
    }
    const endpointPath = apiPath ? url.pathname.slice(apiPath.length) : url.pathname;
    return `${endpointPath || '/'}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * 自家 API 通过 apiClient 发请求，拿到 Bearer token、刷新与 session epoch 保护；
 * 外部 Nominatim 兼容服务仍走匿名 fetch，绝不能把登录凭证发给第三方。
 */
export const geocoderFetch: GeocoderFetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(input);
  const endpoint = apiEndpointFor(url);
  if (endpoint) {
    const payload = await apiClient<unknown>(endpoint, {
      method: init?.method ?? 'GET',
      headers: { Accept: 'application/json' },
      logResponseBody: false,
    });
    return { ok: true, json: async () => payload };
  }
  return fetch(url, init);
};
