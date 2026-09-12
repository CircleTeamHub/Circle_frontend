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

/**
 * 设备自带的地名反查。
 *
 * 由调用方注入 —— 这个模块要能在纯 node 下跑测试，不能直接 import expo-location。
 *
 * 返回 null 表示这个点查不到（继续问服务端）；抛错表示这台设备根本不支持
 * （web 端没有这个 API，国内无 GMS 的 Android 机也没有），之后就别再试了。
 */
export type NativeResolver = (
  latitude: number,
  longitude: number,
) => Promise<ResolvedPlace | null>;

// 设备不支持时置为 true，后续一律跳过——省掉每条位置消息都要抛一次错的开销。
let nativeResolverUnavailable = false;

/** 仅供测试复位。 */
export function resetNativeResolverAvailability(): void {
  nativeResolverUnavailable = false;
}

async function tryNativeResolver(
  resolver: NativeResolver | undefined,
  latitude: number,
  longitude: number,
): Promise<ResolvedPlace | null> {
  if (!resolver || nativeResolverUnavailable) return null;
  try {
    return await resolver(latitude, longitude);
  } catch {
    nativeResolverUnavailable = true;
    return null;
  }
}

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
  nativeResolver?: NativeResolver,
): Promise<ResolvedPlace | null> {
  if (!isUsableCoordinate(latitude, longitude)) return null;
  // 设备自带的反查是免费的，服务端那条路要烧地图服务商的配额——两条都没有才放弃。
  if (!baseUrl && (!nativeResolver || nativeResolverUnavailable)) return null;

  const key = `${baseUrl ?? 'device'}|${cacheKey(latitude, longitude)}`;
  const cached = resolvedCache.get(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = resolveFromAnySource(
    latitude,
    longitude,
    baseUrl,
    nativeResolver,
  )
    .then((place) => {
      // 查不到也缓存，省得同一个点每次展开都再走一遍两条链路。
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

/**
 * 先问设备，再问服务端。
 *
 * 顺序是有成本含义的：设备自带的反查不花钱也不经过我们的服务器，能答上来就不该
 * 再去烧地图服务商按次计费的额度。服务端那条路留给设备答不上来的情况——web 端没有
 * 这个 API，国内无 GMS 的 Android 机也没有，境外坐标设备答得比服务端好。
 */
async function resolveFromAnySource(
  latitude: number,
  longitude: number,
  baseUrl: string | null,
  nativeResolver: NativeResolver | undefined,
): Promise<ResolvedPlace | null> {
  const native = await tryNativeResolver(nativeResolver, latitude, longitude);
  if (native) return native;
  if (!baseUrl) return null;
  return enqueue(() => requestPlace(latitude, longitude, baseUrl));
}
