// 形如 `scheme://`：http、https、file、content、ph 等都算已带 scheme。
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 把存储的语音/媒体来源转成播放器可用的 URI：
 * 裸本地路径补上 file://（iOS AVFoundation / expo-audio 需要带 scheme 的 URI，
 * 裸路径会被当成无 scheme 的 URL 而打不开），已带 scheme 的远程 URL /
 * content URI 原样返回。
 */
export function toPlayableUri(source: string): string {
  if (!source) {
    return source;
  }

  return URI_SCHEME.test(source) ? source : `file://${source}`;
}
