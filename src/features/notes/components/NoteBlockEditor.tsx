import * as ImagePicker from 'expo-image-picker';
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CreateNoteMediaInput } from '@/features/notes/types';
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
  NoteBlockEditorDOM ??= require('@/features/notes/dom/NoteBlockEditor.dom')
    .default as NoteBlockEditorDOMComponent;
  return NoteBlockEditorDOM;
}

// Stable reference so the Expo DOM bridge doesn't see a new `dom` object on
// every render and queue an unnecessary injectJavaScript call.
const DOM_WEBVIEW_PROPS = { useExpoDOMWebView: true } as const;

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
  type: 'image';
  url: string;
  objectKey: string;
  width?: number;
  height?: number;
  mimeType?: string;
  size?: number;
}

interface Props {
  initialContent: Record<string, unknown>[] | null;
  onContentChange: (blocks: Record<string, unknown>[]) => void;
  onMediaUploaded?: (media: CreateNoteMediaInput) => void;
}

export function NoteBlockEditor({ initialContent, onContentChange, onMediaUploaded }: Props) {
  const { resolvedMode } = useTheme();
  const { t } = useTranslation();
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
      imageLabel: t('notes.editor.toolbar.imageLabel', { defaultValue: '图' }),
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

  const handleImageRequest = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets.length) return;

      const asset = result.assets[0];
      const filename = asset.uri.split('/').pop() ?? 'image.jpg';
      const contentType =
        resolveUploadContentType({ mimeType: asset.mimeType, fileName: filename }) ?? 'image/jpeg';

      const presign = await requestUploadPresign({
        filename: sanitizeUploadFilename(filename),
        contentType,
        folder: 'notes',
      });

      await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, asset.uri);

      if (!isMounted.current) return;

      const insert: PendingInsert = {
        type: 'image',
        url: presign.fileUrl,
        objectKey: presign.key,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        mimeType: contentType,
        size: asset.fileSize ?? undefined,
      };
      setPendingInsert(insert);
      onMediaUploaded?.({
        type: 'IMAGE',
        objectKey: presign.key,
        url: presign.fileUrl,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        mimeType: contentType,
        size: asset.fileSize ?? undefined,
        sortOrder: 0,
      });
    } catch (error) {
      if (isMounted.current) {
        Alert.alert(
          t('notes.editor.imageUploadFailedTitle', {
            defaultValue: '图片上传失败',
          }),
          t('notes.editor.imageUploadFailedMessage', {
            defaultValue: '请稍后重试',
          }),
        );
      }
      if (__DEV__) {
        console.warn('[NoteBlockEditor] image upload failed', error);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [onMediaUploaded, t]);

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
          theme={resolvedMode}
          toolbarLabels={toolbarLabels}
        />
      </View>
    </DOMBridgeErrorBoundary>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
});
