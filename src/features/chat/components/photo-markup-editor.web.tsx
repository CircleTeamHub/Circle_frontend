import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import type { PhotoMarkupTool } from '@/features/chat/utils/photo-markup';

/**
 * photo-markup-editor 的 Web 平台档（导出面与原生档保持一致，tsc 两份都查）。
 *
 * 原生档静态依赖 @shopify/react-native-skia，而 Skia 在 web 上需要先装载
 * CanvasKit wasm —— 直接进 import 图会打崩整个 bundle 求值。桌面网页版
 * 暂不做涂鸦/马赛克：photo-editor-modal 在 web 上不放出这两个工具入口，
 * 本档的职责只是保住 import 图不碰 Skia。万一仍被挂载，显示原图并保持
 * 「完成」不可用（onReadyChange(false)），用户可原路退出，不会导出半成品。
 */

interface PhotoMarkupEditorProps {
  asset: ImagePickerAsset;
  tool: PhotoMarkupTool;
  color: string;
  accessibilityLabel: string;
  onCanUndoChange: (canUndo: boolean) => void;
  onReadyChange: (ready: boolean) => void;
}

export interface ExportedMarkupPhoto {
  uri: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface PhotoMarkupEditorHandle {
  undo: () => void;
  exportImage: () => Promise<ExportedMarkupPhoto | null>;
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

export const PhotoMarkupEditor = forwardRef<
  PhotoMarkupEditorHandle,
  PhotoMarkupEditorProps
>(function PhotoMarkupEditorWeb(
  { asset, accessibilityLabel, onCanUndoChange, onReadyChange },
  ref,
) {
  useImperativeHandle(
    ref,
    () => ({
      undo: () => {},
      exportImage: async () => null,
    }),
    [],
  );

  useEffect(() => {
    onReadyChange(false);
    onCanUndoChange(false);
  }, [onCanUndoChange, onReadyChange]);

  return (
    <View style={s.root} accessibilityLabel={accessibilityLabel}>
      <Image source={{ uri: asset.uri }} style={s.image} contentFit="contain" />
    </View>
  );
});
