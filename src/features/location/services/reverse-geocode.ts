/**
 * 把经纬度换成人能读的地名（显式配置的 Nominatim 兼容服务）。
 *
 * 为什么需要：位置消息的地址栏经常只剩一串经纬度 —— web 上 `expo-location`
 * 的 `reverseGeocodeAsync` 根本没有实现，原生端也可能反查失败。气泡里显示
 * 「37.32698, -121.88435」对收件人毫无意义，这里在展开地图时补一次真实地名。
 *
 * 公共 nominatim.openstreetmap.org 不适合 App 直接调用：其 1 req/s 是所有
 * 用户聚合后的上限，客户端也无法提供可控的识别请求头。未配置服务时安全退回
 * 经纬度；生产环境应接自建或带 SLA 的代理。
 *
 * 三条约束用于保护已配置的服务和聊天列表的实际形态：
 * - **缓存**：同一个点（精确到 5 位小数，约 1 米）只查一次。
 * - **并发合流**：同一个点的并发请求共用一个 in-flight Promise。
 * - **串行**：一屏可能有好几条位置消息，不能同时打出去；排队一个一个来。
 *
 * 失败**不缓存** —— 否则一次断网就把这个点永久钉死在经纬度上。
 */

export type ResolvedPlace = {
  title: string;
  address: string;
};

const resolvedCache = new Map<string, ResolvedPlace | null>();
const inFlight = new Map<string, Promise<ResolvedPlace | null>>();

// 队尾只用来串行，永远不传播失败，否则一次报错会卡死后面所有排队的请求。
let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task);
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isUsableCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function cacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

function getConfiguredBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_GEOCODER_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const isLocalHttp =
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.protocol !== 'https:' && !isLocalHttp) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function readPlace(payload: unknown): ResolvedPlace | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const row = payload as { name?: unknown; display_name?: unknown };
  const displayName =
    typeof row.display_name === 'string' ? row.display_name.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  // name 缺失时退到 display_name 的第一段——那一段就是最具体的地名。
  const title = name || displayName.split(',')[0]?.trim() || '';
  if (!title) return null;
  return { title, address: displayName || title };
}

async function requestPlace(
  latitude: number,
  longitude: number,
  baseUrl: string,
): Promise<ResolvedPlace | null> {
  const url = new URL(`${baseUrl}/reverse`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`reverse geocode failed: ${response.status}`);
  return readPlace(await response.json());
}

/**
 * 反查一个坐标点的地名。永不抛错 —— 查不到就返回 null，调用方继续显示经纬度。
 */
export async function resolvePlace(
  latitude: number,
  longitude: number,
  baseUrl = getConfiguredBaseUrl(),
): Promise<ResolvedPlace | null> {
  if (!isUsableCoordinate(latitude, longitude) || !baseUrl) return null;

  const key = `${baseUrl}|${cacheKey(latitude, longitude)}`;
  const cached = resolvedCache.get(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = enqueue(() => requestPlace(latitude, longitude, baseUrl))
    .then((place) => {
      resolvedCache.set(key, place);
      return place;
    })
    // 失败不写缓存：下次展开还能再试一次。
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
