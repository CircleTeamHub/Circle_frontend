import { useState, type CSSProperties } from 'react';

// 网页 DOM 元素的样式:StyleSheet 产出的是 RN 样式,<video> 认的是 CSS。
const FRAME_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  pointerEvents: 'none',
  backgroundColor: '#000',
};

interface WebVideoFirstFrameProps {
  uri: string;
}

/**
 * 网页版没封面的视频:让浏览器自己把开头那一帧画出来。
 *
 * 网页版截不了帧(expo-video 在 Web 上没有截帧),没封面的视频(11-11 之前发的、
 * 从网页版发的)以前只是一块黑。只拉元数据、不播放;`#t=` 让 iOS Safari 停在这一帧上
 * 画出来,片段不发给服务器,签名地址不受影响。只在 Web 上渲染。
 */
export function WebVideoFirstFrame({ uri }: WebVideoFirstFrameProps) {
  // 加载失败(比如签名地址过期)就退回黑底;地址换新了再试。
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (failedUri === uri) return null;
  return (
    <video
      src={`${uri}#t=0.1`}
      preload="metadata"
      muted
      playsInline
      disablePictureInPicture
      tabIndex={-1}
      aria-hidden
      style={FRAME_STYLE}
      onError={() => setFailedUri(uri)}
    />
  );
}
