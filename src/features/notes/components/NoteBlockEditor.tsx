import * as ImagePicker from 'expo-image-picker';
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CreateNoteMediaInput } from '@/features/notes/types';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { useTheme } from '@/theme';
import NoteBlockEditorDOM from '@/features/notes/dom/NoteBlockEditor.dom';

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
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(null);
  // Prevent async setState calls after unmount — these are the root cause of
  // the "Unable to find the 'DomWebView' view" bridge error: a state update
  // after unmount causes React to try to push new props into the torn-down WebView.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleImageRequest = useCallback(async () => {
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
  }, [onMediaUploaded]);

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
      } catch {
        // malformed JSON from bridge — ignore
      }
    },
    [onContentChange],
  );

  return (
    <DOMBridgeErrorBoundary>
      <View style={s.container}>
        <NoteBlockEditorDOM
          dom={DOM_WEBVIEW_PROPS}
          initialContent={initialContentJson}
          pendingInsert={pendingInsert}
          onContentChange={handleContentChangeJson}
          onInsertHandled={handleInsertHandled}
          onImageRequest={handleImageRequest}
          theme={resolvedMode}
        />
      </View>
    </DOMBridgeErrorBoundary>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
});
