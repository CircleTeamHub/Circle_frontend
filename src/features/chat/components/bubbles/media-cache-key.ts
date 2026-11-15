/** 本机文件等本地地址:不挂存储 key 当缓存键,免得把本地原片记在远端那张的名下。 */
const LOCAL_URI = /^(?:file|content|ph|assets-library|data|blob):/i;

/**
 * 远端图片的缓存键用存储 object key:签名地址每小时轮换,按地址缓存的话同一张图
 * 过了窗口就整张重新下载。
 */
export function remoteCacheKey(
  uri: string | undefined,
  key: string | undefined,
): string | undefined {
  return uri && key && !LOCAL_URI.test(uri) ? key : undefined;
}
