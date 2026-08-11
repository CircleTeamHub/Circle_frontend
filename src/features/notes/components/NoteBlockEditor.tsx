import * as ImagePicker from 'expo-image-picker';
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CreateNoteMediaInput } from '@/features/notes/types';
import { getNoteVideoUploadPolicyViolation } from '@/features/notes/utils/note-media-policy';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useTheme } from '@/theme';

type NoteBlockEditorDOMComponent =
  typeof import('@/features/notes/dom/NoteBlockEditor.dom').default;

let NoteBlockEditorDOM: NoteBlockEditorDOMComponent | null = null;

function canLoadDOMEditor() {
  return Platform.OS !== 'web' || typeof window !== 'undefined';
}

function getNoteBlockEditorDOM() {
  // Lazy sync load keeps Expo DOM out of the native startup path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NoteBlockEditorDOM ??= require('@/features/notes/dom/NoteBlockEditor.dom')
    .default as NoteBlockEditorDOMComponent;
  return NoteBlockEditorDOM;
}

// Stable reference so the Expo DOM bridge doesn't see a new `dom` object on
// every render and queue an unnecessary injectJavaScript call.
const DOM_WEBVIEW_PROPS = { useExpoDOMWebView: true } as const;

// Videos aren't duration-capped, so they need a far longer upload window than
// the 60s image default before the timeout fires.
const VIDEO_UPLOAD_TIMEOUT_MS = 5 * 60_000;

// Silently catches the Expo DOM bridge error that fires when injectJavaScript
// is called on an already-unmounted WebView (e.g. during navigation teardown).
class DOMBridgeErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    // Once the WebView bridge errors out, render nothing — the screen is
    // already unmounting so there is nothing visible to show.
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

interface PendingInsert {
  type: 'image' | 'video';
  url: string;
  objectKey: string;
  width?: number;
  height?: number;
  mimeType?: string;
  size?: number;
  durationMs?: number;
}

interface Props {
  initialContent: Record<string, unknown>[] | null;
  onContentChange: (blocks: Record<string, unknown>[]) => void;
  onMediaUploaded?: (media: CreateNoteMediaInput) => void;
  mediaToolbarEnabled?: boolean;
}

function NoteBlockEditorImpl({
  initialContent,
  onContentChange,
  onMediaUploaded,
  mediaToolbarEnabled = true,
}: Props) {
  const { resolvedMode } = useTheme();
  const { t, i18n } = useTranslation();
  // BlockNote runs in the DOM bridge realm where i18n can't reach, so resolve
  // the language here and pass it through to localize the editor.
  const language: 'zh' | 'en' = i18n.language?.startsWith('zh') ? 'zh' : 'en';
  const toolbarLabels = useMemo(
    () => ({
      headingType: t('notes.editor.toolbar.heading', { defaultValue: '标题' }),
      paragraphType: t('notes.editor.toolbar.paragraph', {
        defaultValue: '正文',
      }),
      bulletListType: t('notes.editor.toolbar.bulletList', {
        defaultValue: '列表',
      }),
      imageTitle: t('notes.editor.toolbar.imageTitle', { defaultValue: '图片' }),
      videoTitle: t('notes.editor.toolbar.videoTitle', { defaultValue: '视频' }),
      codeTitle: t('notes.editor.toolbar.code', { defaultValue: '代码' }),
    }),
    [t],
  );
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
  // Prevent async setState calls after unmount — these are the root cause of
  // the "Unable to find the 'DomWebView' view" bridge error: a state update
  // after unmount causes React to try to push new props into the torn-down WebView.
  const isMounted = useRef(true);
  // 防止用户连点"图"两下触发并发上传（每次都会跑 presign + S3 PUT 一整条链路）。
  const inFlightRef = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Image and video share one pick → presign → upload → insert pipeline; only
  // the picker filter, fallbacks, upload timeout and media type differ by kind.
  const pickUploadAndInsert = useCallback(
    async (kind: 'image' | 'video') => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return;

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: kind === 'video' ? ['videos'] : ['images'],
          quality: 0.85,
          allowsMultipleSelection: false,
        });
        if (result.canceled || !result.assets.length) return;

        const asset = result.assets[0];
        if (kind === 'video') {
          const violation = getNoteVideoUploadPolicyViolation({
            fileSize: asset.fileSize,
            duration: asset.duration,
          });
          if (violation) {
            Alert.alert(
              t('notes.editor.videoRejectedTitle', {
                defaultValue: '视频无法上传',
              }),
              violation === 'size'
                ? t('notes.editor.videoTooLargeMessage', {
                    defaultValue: '请选择 200MB 以内的视频',
                  })
                : t('notes.editor.videoTooLongMessage', {
                    defaultValue: '请选择 10 分钟以内的视频',
                  }),
            );
            return;
          }
        }

        const fallbackName = kind === 'video' ? 'video.mp4' : 'image.jpg';
        const fallbackType = kind === 'video' ? 'video/mp4' : 'image/jpeg';
        const filename = asset.uri.split('/').pop() ?? fallbackName;
        const contentType =
          resolveUploadContentType({ mimeType: asset.mimeType, fileName: filename }) ??
          fallbackType;

        const presign = await requestUploadPresign({
          filename: sanitizeUploadFilename(filename),
          contentType,
          folder: 'notes',
          fileUri: asset.uri,
        });

        await uploadLocalFileToPresignedUrl(
          presign.uploadUrl,
          contentType,
          asset.uri,
          kind === 'video' ? VIDEO_UPLOAD_TIMEOUT_MS : undefined,
        );

        if (!isMounted.current) return;

        const durationMs =
          kind === 'video' && typeof asset.duration === 'number'
            ? Math.round(asset.duration)
            : undefined;

        setPendingInsert({
          type: kind,
          url: presign.fileUrl,
          objectKey: presign.key,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          mimeType: contentType,
          size: asset.fileSize ?? undefined,
          durationMs,
        });
        onMediaUploaded?.({
          type: kind === 'video' ? 'VIDEO' : 'IMAGE',
          objectKey: presign.key,
          url: presign.fileUrl,
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          mimeType: contentType,
          size: asset.fileSize ?? undefined,
          durationMs,
          sortOrder: 0,
        });
      } catch (error) {
        if (isMounted.current) {
          Alert.alert(
            t('notes.editor.mediaUploadFailedTitle', {
              defaultValue: '上传失败',
            }),
            t('notes.editor.mediaUploadFailedMessage', {
              defaultValue: '请稍后重试',
            }),
          );
        }
        if (__DEV__) {
          console.warn(`[NoteBlockEditor] ${kind} upload failed`, error);
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [onMediaUploaded, t],
  );

  const handleImageRequest = useCallback(
    () => pickUploadAndInsert('image'),
    [pickUploadAndInsert],
  );
  const handleVideoRequest = useCallback(
    () => pickUploadAndInsert('video'),
    [pickUploadAndInsert],
  );

  const handleInsertHandled = useCallback(() => {
    if (!isMounted.current) return;
    setPendingInsert(null);
  }, []);

  // DOM bridge only supports primitives — pass content as JSON string and
  // parse the response back to blocks on the native side.
  const initialContentJson =
    initialContent && initialContent.length > 0 ? JSON.stringify(initialContent) : null;

  const handleContentChangeJson = useCallback(
    (blocksJson: string) => {
      if (!isMounted.current) return;
      try {
        const blocks = JSON.parse(blocksJson) as Record<string, unknown>[];
        onContentChange(blocks);
      } catch (error) {
        // malformed JSON from bridge — drop the update, but surface in dev so
        // bridge serialization regressions don't go unnoticed.
        if (__DEV__) {
          console.warn('[NoteBlockEditor] malformed JSON from DOM bridge', error);
        }
      }
    },
    [onContentChange],
  );

  if (!canLoadDOMEditor()) {
    return <View style={s.container} />;
  }

  const DOMEditor = getNoteBlockEditorDOM();

  return (
    <DOMBridgeErrorBoundary>
      <View style={s.container}>
        <DOMEditor
          dom={DOM_WEBVIEW_PROPS}
          initialContent={initialContentJson}
          pendingInsert={pendingInsert}
          onContentChange={handleContentChangeJson}
          onInsertHandled={handleInsertHandled}
          onImageRequest={handleImageRequest}
          onVideoRequest={handleVideoRequest}
          theme={resolvedMode}
          language={language}
          toolbarLabels={toolbarLabels}
          mediaToolbarEnabled={mediaToolbarEnabled}
        />
      </View>
    </DOMBridgeErrorBoundary>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
});

// props 稳定（initialContent/onContentChange/mediaToolbarEnabled 不随父屏无关状态变化），
// memo 化避免编辑父屏（如标题输入）每次按键都重渲染这个较重的 DOM 编辑器包裹层。
export const NoteBlockEditor = memo(NoteBlockEditorImpl);
