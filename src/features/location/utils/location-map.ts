const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;

/**
 * 底图样式。
 *
 * 数据还是 OpenStreetMap，换的是**渲染样式**：OSM 官方的 Carto 样式是给制图/编辑
 * 用的——配色浓、标注密、什么都往上画，塞进 252×124 的聊天气泡里就是一团糊。
 * CARTO 的 Voyager / Dark Matter 是同一份 OSM 数据的「底图向」渲染：留白多、
 * 道路层级清楚、标注克制，小尺寸下才读得出来。
 *
 * 为什么不是高德：高德用 GCJ-02 火星坐标，而这套栈从存库、nominatim 反查到
 * 拉起系统地图全是 WGS-84，换过去等于每个边界都要加一层偏移转换，已经发出去的
 * 位置消息还会整体偏 100–500 米；更要命的是高德海外基本没有数据（实测
 * z15 的圣何塞瓦片只有 179 字节，是一张空白图）。
 */
export type BasemapScheme = 'light' | 'dark';

const BASEMAP_STYLE_PATH: Record<BasemapScheme, string> = {
  light: 'rastertiles/voyager',
  dark: 'dark_all',
};

export const BASEMAP_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
export const BASEMAP_MAX_ZOOM = 20;

export type BasemapOptions = {
  scheme?: BasemapScheme;
  /** 高分屏取 512px 的 `@2x` 瓦片，仍按 256 CSS px 摆放。 */
  retina?: boolean;
};

/**
 * Leaflet 用的模板，`{r}` 留给调用方按 devicePixelRatio 自己填。
 *
 * 不要交给 Leaflet 的 `detectRetina`：那个开关除了把 `{r}` 换成 `@2x`，还会把
 * tileSize 砍半、zoom 加一 —— 于是同一屏要拉 4 倍数量的瓦片，每张还是 2 倍尺寸
 * （满屏能到几 MB）。我们只要「同样数量、双倍分辨率」。
 */
export function getBasemapUrlTemplate(scheme: BasemapScheme): string {
  return `https://basemaps.cartocdn.com/${BASEMAP_STYLE_PATH[scheme]}/{z}/{x}/{y}{r}.png`;
}

function basemapTile(
  scheme: BasemapScheme,
  zoom: number,
  x: number,
  y: number,
  retina: boolean,
): string {
  const suffix = retina ? '@2x' : '';
  return `https://basemaps.cartocdn.com/${BASEMAP_STYLE_PATH[scheme]}/${zoom}/${x}/${y}${suffix}.png`;
}

const COORDINATE_ONLY_ADDRESS = /^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/;

/**
 * 地址栏里只剩一串经纬度时为 true。
 *
 * 反查地址失败（web 上 expo-location 压根没有 reverseGeocodeAsync）或者用户
 * 开图就直接发送时，位置消息带的 address 就长这样。调用方据此决定要不要补一次
 * 反查——已经是真实地址的绝不重复请求。
 */
export function isCoordinateOnlyAddress(
  address: string | null | undefined,
): boolean {
  if (typeof address !== 'string') return false;
  if (!address.trim()) return true;
  return COORDINATE_ONLY_ADDRESS.test(address);
}

export function hasValidLocationCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): latitude is number {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function getOpenStreetMapTileUrl(
  latitude: number,
  longitude: number,
  zoom = 15,
  { scheme = 'light', retina = true }: BasemapOptions = {},
): string | null {
  if (!hasValidLocationCoordinates(latitude, longitude)) return null;
  const safeZoom = Math.min(19, Math.max(0, Math.round(zoom)));
  const tileCount = 2 ** safeZoom;
  const mercatorLatitude = Math.min(
    WEB_MERCATOR_MAX_LATITUDE,
    Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
  const latitudeRadians = (mercatorLatitude * Math.PI) / 180;
  const x = Math.min(
    tileCount - 1,
    Math.max(0, Math.floor(((longitude + 180) / 360) * tileCount)),
  );
  const y = Math.min(
    tileCount - 1,
    Math.max(
      0,
      Math.floor(
        ((1 -
          Math.log(
            Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians),
          ) /
            Math.PI) /
          2) *
          tileCount,
      ),
    ),
  );
  return basemapTile(scheme, safeZoom, x, y, retina);
}

export function getOpenStreetMapPreviewTiles(
  latitude: number,
  longitude: number,
  width: number,
  height: number,
  zoom = 15,
  { scheme = 'light', retina = true }: BasemapOptions = {},
): {
  tiles: { url: string; left: number; top: number }[];
  markerLeft: number;
  markerTop: number;
} | null {
  if (
    !hasValidLocationCoordinates(latitude, longitude) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const safeZoom = Math.min(19, Math.max(0, Math.round(zoom)));
  const tileCount = 2 ** safeZoom;
  const worldSize = tileCount * 256;
  const mercatorLatitude = Math.min(
    WEB_MERCATOR_MAX_LATITUDE,
    Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
  const latitudeRadians = (mercatorLatitude * Math.PI) / 180;
  const worldX = ((longitude + 180) / 360) * worldSize;
  const worldY =
    ((1 -
      Math.log(
        Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians),
      ) /
        Math.PI) /
      2) *
    worldSize;
  const leftEdge = worldX - width / 2;
  const topEdge = worldY - height / 2;
  const minTileX = Math.floor(leftEdge / 256);
  const maxTileX = Math.floor((leftEdge + width - 1) / 256);
  const minTileY = Math.floor(topEdge / 256);
  const maxTileY = Math.floor((topEdge + height - 1) / 256);
  const tiles: { url: string; left: number; top: number }[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        url: basemapTile(scheme, safeZoom, wrappedTileX, tileY, retina),
        left: tileX * 256 - leftEdge,
        top: tileY * 256 - topEdge,
      });
    }
  }
  return {
    tiles,
    markerLeft: width / 2,
    markerTop: height / 2,
  };
}


// ---------------------------------------------------------------------------
// GCJ-02（火星坐标）
// ---------------------------------------------------------------------------

/**
 * 中国法定的加偏坐标系。高德 / 百度 / 腾讯以及任何在国内落地的地图服务，读到的
 * 坐标都按 GCJ-02 解释；GPS、OpenStreetMap、Nominatim 则是 WGS-84。同一个点两者
 * 在国内差 300～600 米（深圳市民中心 607 米，北京天安门 556 米）——正好是一个
 * 街区，图钉会落到隔壁楼。
 *
 * 这套栈的**存储口径是 WGS-84**（选点页的坐标来自 Leaflet/OSM 地图与 Nominatim
 * 搜索），只有在把坐标交给国内地图 app 时才需要加偏。
 */
const GCJ02_A = 6378245.0;
const GCJ02_EE = 0.00669342162296594323;

/**
 * 加偏只在国境内定义。境外照搬公式会把坐标推歪几公里，所以先过这道闸门 ——
 * 这也让「国内为主、但用户在境外」这种情况自动退化成不做任何转换。
 */
function isOutOfChina(latitude: number, longitude: number): boolean {
  return (
    longitude < 72.004 ||
    longitude > 137.8347 ||
    latitude < 0.8293 ||
    latitude > 55.8271
  );
}

function gcj02TransformLatitude(x: number, y: number): number {
  let result =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  result +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return result;
}

function gcj02TransformLongitude(x: number, y: number): number {
  let result =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  result +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return result;
}

/**
 * WGS-84 → GCJ-02。境外坐标与非法坐标原样返回 / 返回 null，调用方无需自己判断。
 */
export function wgs84ToGcj02(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } | null {
  if (!hasValidLocationCoordinates(latitude, longitude)) return null;
  if (isOutOfChina(latitude, longitude)) return { latitude, longitude };

  const deltaLatitude = gcj02TransformLatitude(longitude - 105, latitude - 35);
  const deltaLongitude = gcj02TransformLongitude(longitude - 105, latitude - 35);
  const radians = (latitude * Math.PI) / 180;
  const magic = 1 - GCJ02_EE * Math.sin(radians) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  return {
    latitude:
      latitude +
      (deltaLatitude * 180) /
        (((GCJ02_A * (1 - GCJ02_EE)) / (magic * sqrtMagic)) * Math.PI),
    longitude:
      longitude +
      (deltaLongitude * 180) /
        ((GCJ02_A / sqrtMagic) * Math.cos(radians) * Math.PI),
  };
}

export function buildSystemMapUrls(
  latitude: number,
  longitude: number,
  label: string,
) {
  const coordinates = `${latitude},${longitude}`;
  const encodedLabel = encodeURIComponent(label || coordinates);
  // 国内的 geo: 由高德 / 百度 / 腾讯地图接管，它们把 URI 里的坐标当 GCJ-02 读。
  // 传 WGS-84 进去，图钉会落在 500 米开外。境外 isOutOfChina 会让它原样返回，
  // 所以 Google Maps 那条路径不受影响。
  // 加偏后的值是算出来的，带一长串无意义的浮点尾数；6 位小数已经是 0.1 米量级，
  // 远超 GPS 本身的精度。境外不加偏时这里等价于原样输出。
  const round6 = (value: number) => String(Math.round(value * 1e6) / 1e6);
  const shifted = wgs84ToGcj02(latitude, longitude);
  const geoCoordinates = shifted
    ? `${round6(shifted.latitude)},${round6(shifted.longitude)}`
    : coordinates;
  return {
    // Apple Maps 收 WGS-84，中国区的显示偏移由它自己处理。
    ios: `maps://?ll=${coordinates}&q=${encodedLabel}`,
    android: `geo:${geoCoordinates}?q=${geoCoordinates}(${encodedLabel})`,
    fallback: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
  };
}
