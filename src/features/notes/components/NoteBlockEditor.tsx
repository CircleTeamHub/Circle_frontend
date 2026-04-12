import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
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
    setPendingInsert(null);
  }, []);

  return (
    <View style={s.container}>
      <NoteBlockEditorDOM
        dom={{ useExpoDOMWebView: true }}
        initialContent={initialContent}
        pendingInsert={pendingInsert}
        onContentChange={onContentChange}
        onInsertHandled={handleInsertHandled}
        onImageRequest={handleImageRequest}
        theme={resolvedMode}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
});
