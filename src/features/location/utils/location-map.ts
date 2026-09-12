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

/** 一个格子在预览图里的位置，与具体底图源无关。 */
type TileCell = {
  zoom: number;
  x: number;
  y: number;
  left: number;
  top: number;
};

type TileGrid = {
  cells: TileCell[];
  markerLeft: number;
  markerTop: number;
};

/**
 * 铺满一块 width×height 画布需要哪些瓦片、各自摆在哪。
 *
 * 只算几何，不碰 URL —— 于是 CARTO 与天地图能共用同一套摆放逻辑，换底图源只是
 * 把格子换成另一个服务的地址。
 */
function computeTileGrid(
  latitude: number,
  longitude: number,
  width: number,
  height: number,
  zoom: number,
  maxZoom: number,
): TileGrid | null {
  if (
    !hasValidLocationCoordinates(latitude, longitude) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const safeZoom = Math.min(maxZoom, Math.max(0, Math.round(zoom)));
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
  const cells: TileCell[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      cells.push({
        zoom: safeZoom,
        x: wrappedTileX,
        y: tileY,
        left: tileX * 256 - leftEdge,
        top: tileY * 256 - topEdge,
      });
    }
  }
  return {
    cells,
    markerLeft: width / 2,
    markerTop: height / 2,
  };
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
  const grid = computeTileGrid(latitude, longitude, width, height, zoom, 19);
  if (!grid) return null;
  return {
    tiles: grid.cells.map((cell) => ({
      url: basemapTile(scheme, cell.zoom, cell.x, cell.y, retina),
      left: cell.left,
      top: cell.top,
    })),
    markerLeft: grid.markerLeft,
    markerTop: grid.markerTop,
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
  return {
    // Apple Maps 收 WGS-84，中国区的显示偏移由它自己处理。
    ios: `maps://?ll=${coordinates}&q=${encodedLabel}`,
    // RFC 5870 的 geo: 默认坐标系是 WGS-84。它是通用 intent，不能预先按某个
    // 国内地图供应商转换成 GCJ-02，否则 Google Maps / OsmAnd 等会偏移数百米。
    android: `geo:${coordinates}?q=${coordinates}(${encodedLabel})`,
    fallback: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
  };
}

// ---------------------------------------------------------------------------
// 底图源
// ---------------------------------------------------------------------------

/**
 * 底图数据从哪来。
 *
 * 绝大多数用户在大陆，而 CARTO 的 OSM 瓦片在境内既没有 CDN 节点、中文标注也稀疏。
 * 境内因此改用高德的地图 JS API，境外继续用 CARTO —— 高德在境外基本没有数据
 * （实测 z15 的圣何塞瓦片只有 179 字节，是一张空白图）。
 *
 * 为什么不是天地图：它在坐标系上本来更合适（CGCS2000 与 WGS-84 在地图尺度上无
 * 差别，不需要任何偏移转换），但实测其瓦片接口、主站与开发者站**对境外一律拒绝
 * 访问**（CloudWAF 418 / 连接超时）。也就是说在境外既申请不到密钥，也无法验收。
 * 高德则全线可达，境外也能开发和自测。
 */
export type BasemapProvider = 'carto' | 'amap';

const AMAP_JS_API_ORIGIN = 'https://webapi.amap.com';
const AMAP_ATTRIBUTION = '© 高德地图';

function readAmapJsKey(): string {
  // Expo 是按字面量静态替换 process.env.EXPO_PUBLIC_*，这里只能写成完整形式。
  return (process.env.EXPO_PUBLIC_AMAP_JS_KEY ?? '').trim();
}

function readAmapSecurityCode(): string {
  return (process.env.EXPO_PUBLIC_AMAP_SECURITY_CODE ?? '').trim();
}

/**
 * 这个坐标该用哪个底图源。
 *
 * 没配高德 key，或者坐标在境外，都回落到 CARTO —— 回落后的表现与接入前完全一致，
 * 不会退步成白图。
 */
export function getBasemapProvider(
  latitude: number,
  longitude: number,
  amapJsKey = readAmapJsKey(),
): BasemapProvider {
  if (!amapJsKey) return 'carto';
  if (!hasValidLocationCoordinates(latitude, longitude)) return 'carto';
  return isOutOfChina(latitude, longitude) ? 'carto' : 'amap';
}

export function getBasemapAttribution(provider: BasemapProvider): string {
  return provider === 'amap' ? AMAP_ATTRIBUTION : BASEMAP_ATTRIBUTION;
}

/**
 * 地图页要加载的高德 JS API 地址。未配 key 时返回 null，调用方据此回落到 Leaflet。
 *
 * 2021-12-02 之后申请的 key 必须搭配安全密钥使用，而且那段配置必须在脚本加载**之前**
 * 执行，否则不生效 —— 所以这里把两样一起交给调用方。
 */
export function getAmapScriptConfig(
  amapJsKey = readAmapJsKey(),
  securityCode = readAmapSecurityCode(),
): { scriptUrl: string; securityCode: string } | null {
  if (!amapJsKey) return null;
  return {
    // plugin 必须在这里声明：JS API 的插件是随主脚本一起同步加载的，
    // 漏了它 AMap.ToolBar 永远不存在，地图上就没有缩放控件。
    scriptUrl: `${AMAP_JS_API_ORIGIN}/maps?v=2.0&key=${encodeURIComponent(amapJsKey)}&plugin=AMap.ToolBar`,
    securityCode,
  };
}

/**
 * GCJ-02 → WGS-84。境外坐标原样返回，非法坐标返回 null。
 *
 * 高德吐出来的每一个坐标（点击、拖拽、定位）都是 GCJ-02，而这套栈的存储口径是
 * WGS-84，所以进 App 之前必须在这里减偏。加偏公式没有闭式反解，用不动点迭代逼近：
 * 拿当前猜测正向加偏，把与目标的差额补回猜测里。收敛极快，三轮就到厘米级。
 */
export function gcj02ToWgs84(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } | null {
  if (!hasValidLocationCoordinates(latitude, longitude)) return null;
  if (isOutOfChina(latitude, longitude)) return { latitude, longitude };

  let guessLatitude = latitude;
  let guessLongitude = longitude;
  for (let round = 0; round < 5; round += 1) {
    const shifted = wgs84ToGcj02(guessLatitude, guessLongitude);
    if (!shifted) return null;
    guessLatitude += latitude - shifted.latitude;
    guessLongitude += longitude - shifted.longitude;
  }
  return { latitude: guessLatitude, longitude: guessLongitude };
}
