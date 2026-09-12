import * as Location from 'expo-location';
import type { ResolvedPlace } from './reverse-geocode';

/**
 * 用设备自带的地理编码把坐标换成地名。
 *
 * 为什么优先用它：这一路不花钱，也不经过我们的服务器。地图服务商的逆地理编码是
 * 按次计费的，而位置消息每被展开一次就要问一次地名——能让系统答上来的，就不该去
 * 烧那份额度。
 *
 * 两种失败要分开看，调用方据此决定要不要再问服务端：
 * - **抛错**：这台设备根本没有这个能力。web 端 expo-location 没有实现
 *   `reverseGeocodeAsync`，国内没有 Google 移动服务的 Android 机也没有。
 * - **返回 null**：设备支持，但这个点查不到。
 *
 * 坐标按 WGS-84 传入，也就是系统定位本来给出的那套 —— iOS 的 Core Location 与
 * Android 的定位接口都以 WGS-84 为准，中国境内的偏移由系统自己处理。
 * （注：squady 那边是先转成 GCJ-02 再喂进去的，两种做法在真机上的差别值得留意。）
 */
export async function resolvePlaceOnDevice(
  latitude: number,
  longitude: number,
): Promise<ResolvedPlace | null> {
  const places = await Location.reverseGeocodeAsync({ latitude, longitude });
  const place = places[0];
  if (!place) return null;
  return formatDevicePlace(place);
}

/**
 * 把系统返回的地址分量拼成「标题 + 全址」。
 *
 * 各家系统填的字段并不一致，所以每一层都留了退路；去重是因为小城市里
 * city 和 region 经常是同一个词，拼出来会变成「深圳市 深圳市」。
 */
export function formatDevicePlace(
  place: Location.LocationGeocodedAddress,
): ResolvedPlace | null {
  const title = place.name || place.street || '';
  const parts = [
    place.city ?? place.region,
    place.district ?? place.subregion,
    place.street,
    place.name,
  ].filter((part): part is string => Boolean(part && part.trim()));

  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) unique.push(part);
  }

  const address = unique.join(' ');
  if (!title && !address) return null;
  return { title: title || address, address: address || title };
}
