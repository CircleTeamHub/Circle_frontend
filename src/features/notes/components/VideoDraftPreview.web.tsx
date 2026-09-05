import { createElement, useEffect, useState } from 'react';

const THUMBNAIL_WIDTH = 320;
const FRAME_CAPTURE_TIMEOUT_MS = 5_000;

type BrowserDocument = Pick<Document, 'createElement'>;

function isReadyForFrame(video: HTMLVideoElement) {
  return video.readyState >= 2; // HTMLMediaElement.HAVE_CURRENT_DATA
}

/** Captures a small still without playing and releases the detached decoder element on every path. */
export function captureVideoFrame(
  uri: string,
  documentRef: BrowserDocument = document,
  signal?: AbortSignal,
) {
  return new Promise<string | null>((resolve) => {
    const video = documentRef.createElement('video');
    const canvas = documentRef.createElement('canvas');
    let settled = false;
    let requiresSeek = false;
    let seekCompleted = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish();
    const onError = () => finish();
    const onLoadedMetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0) return capture();
      const targetTime = Math.min(0.1, duration / 2);
      requiresSeek = true;
      video.currentTime = targetTime;
    };
    const onSeeked = () => {
      seekCompleted = true;
      capture();
    };
    const cleanUp = () => {
      video.removeEventListener('loadeddata', capture);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (timeoutId) clearTimeout(timeoutId);
      video.removeAttribute('src');
      video.load();
      video.remove();
    };
    const finish = (value: string | null = null) => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve(value);
    };
    const capture = () => {
      if (signal?.aborted || !isReadyForFrame(video) || (requiresSeek && !seekCompleted)) return;
      const context = canvas.getContext('2d');
      if (!context || !video.videoWidth || !video.videoHeight) return finish();
      const scale = Math.min(
        1,
        THUMBNAIL_WIDTH / video.videoWidth,
        THUMBNAIL_WIDTH / video.videoHeight,
      );
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      finish(canvas.toDataURL('image/jpeg', 0.8));
    };

    video.muted = true;
    video.autoplay = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('loadeddata', capture, { once: true });
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = setTimeout(() => finish(), FRAME_CAPTURE_TIMEOUT_MS);
    video.src = uri;
    video.load();
  });
}

/** Captures one browser frame into a small data URL; no video decoder remains mounted in the grid. */
export function VideoDraftPreview({ uri }: { uri: string }) {
  const [frameUri, setFrameUri] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFrameUri(null);
    void captureVideoFrame(uri, document, controller.signal).then((nextFrameUri) => {
      if (!controller.signal.aborted) setFrameUri(nextFrameUri);
    });
    return () => controller.abort();
  }, [uri]);

  if (!frameUri) {
    return createElement('div', {
      'data-testid': 'note-media-preview-video-loading',
      testID: 'note-media-preview-video-loading',
      style: { width: '100%', height: '100%', backgroundColor: '#000' },
    });
  }
  return createElement('img', {
    'data-testid': 'note-media-preview-video',
    testID: 'note-media-preview-video',
    src: frameUri,
    alt: '',
    style: { width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' },
  });
}
