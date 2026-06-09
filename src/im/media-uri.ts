// 本地媒体路径的 scheme 在两端要求相反，这里把互逆的两个操作放在一起，避免改了一端忘了另一端。
// - 发送：OpenIM SDK 需要不带 file:// 的裸路径（createSoundMessageFromFullPath / createImageMessageByURL）。
// - 播放：iOS AVFoundation / expo-audio 需要带 scheme 的 URI，裸路径会被当成无 scheme 的 URL 而打不开
//   （表现为 MediaToolbox FigFilePlayer err=-12864）。

// 形如 `scheme://`：http、https、file、content、ph 等都算已带 scheme。
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** 去掉开头的 file://，给 OpenIM SDK 传裸文件路径。 */
export function stripFileScheme(path: string): string {
  return path.replace(/^file:\/\//, '');
}

/**
 * 把存储的语音/媒体来源转成播放器可用的 URI：
 * 裸本地路径补上 file://，已带 scheme 的远程 URL / content URI 原样返回。
 */
export function toPlayableUri(source: string): string {
  if (!source) {
    return source;
  }

  return URI_SCHEME.test(source) ? source : `file://${source}`;
}
