import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { UploadProgressHost } from '@/components/app/UploadProgressHost';
import { FreePhotoCropper } from '@/features/chat/components/free-photo-cropper';
import type { PhotoCropRect } from '@/features/chat/utils/photo-editor';
import { reportHandledFailure } from '@/observability/report-failure';
import { Spacing, Typography } from '@/theme';

/**
 * 相册选图后的裁剪步骤：头像、圈子徽章 1:1，封面、聊天背景自由比例。
 *
 * iOS 上 allowsEditing 会让 expo-image-picker 从 PHPicker 退回
 * UIImagePickerController，后者弹出前要枚举整个照片库，照片多时点击后卡好几秒。
 * 所以 iOS 相册不开它，选完在应用内裁剪；安卓的系统裁剪发生在选图之后，不影响弹出速度。
 */
export type ImageCropShape = 'square' | 'free';

export function getCropLibraryPickerOptions(shape: ImageCropShape): { allowsEditing?: true; aspect?: [number, number] } {
  if (Platform.OS === 'ios') return {};
  return shape === 'square' ? { allowsEditing: true, aspect: [1, 1] } : { allowsEditing: true };
}

const PICKER_DISMISS_SETTLE_MS = 500;

interface ImageCropModalProps {
  asset: ImagePickerAsset;
  shape: ImageCropShape;
  onCancel: () => void;
  onCropped: (asset: ImagePickerAsset) => void;
}

function ImageCropModal({ asset, shape, onCancel, onCropped }: ImageCropModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [crop, setCrop] = useState<PhotoCropRect | null>(null);
  const [busy, setBusy] = useState(false);
  const title = shape === 'square' ? t('chat.photoEditor.cropSquare') : t('chat.photoEditor.freeCropTitle');

  const confirm = async () => {
    if (!crop || busy) return;
    setBusy(true);
    // 徽章常是透明 PNG，转 JPEG 会把透明背景压成实色。
    const preservePng = asset.mimeType === 'image/png' || Boolean(asset.fileName?.toLowerCase().endsWith('.png'));
    try {
      const result = await manipulateAsync(asset.uri, [{ crop }], {
        compress: preservePng ? 1 : 0.8,
        format: preservePng ? SaveFormat.PNG : SaveFormat.JPEG,
      });
      onCropped({
        ...asset,
        uri: result.uri,
        width: result.width,
        height: result.height,
        mimeType: preservePng ? 'image/png' : 'image/jpeg',
        fileName: asset.fileName ? `${asset.fileName.replace(/\.[^./]+$/, '')}.${preservePng ? 'png' : 'jpg'}` : asset.fileName,
        fileSize: undefined,
        assetId: null,
        base64: null,
        exif: null,
      });
    } catch (error) {
      setBusy(false);
      reportHandledFailure('imageCrop', 'squareCrop', error);
      Alert.alert(t('chat.photoEditor.editFailedTitle'), t('chat.photoEditor.editFailedMessage'));
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={busy ? undefined : onCancel}>
      <StatusBar style="light" />
      <View style={[s.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
        <View style={s.header}>
          <Pressable style={s.headerSide} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Text style={s.action}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          <Pressable style={[s.headerSide, s.confirm]} onPress={() => void confirm()} disabled={!crop || busy} accessibilityRole="button" accessibilityLabel={t('common.confirm')} accessibilityState={{ disabled: !crop || busy }}>
            <Text style={s.action}>{t('common.confirm')}</Text>
          </Pressable>
        </View>
        <View style={s.preview}>
          <FreePhotoCropper square={shape === 'square'} asset={asset} onCropChange={setCrop} accessibilityLabel={title} />
          {busy ? <View style={s.busy}><ActivityIndicator color="#FFFFFF" /></View> : null}
        </View>
        <UploadProgressHost />
      </View>
    </Modal>
  );
}

interface PendingCrop {
  asset: ImagePickerAsset;
  resolve: (asset: ImagePickerAsset | null) => void;
}

export interface ImageCropStep {
  /** 按平台补上裁剪；resolve 为 null 表示用户取消。安卓已由系统裁好，原样返回。 */
  cropIfNeeded: (asset: ImagePickerAsset) => Promise<ImagePickerAsset | null>;
  /** 裁剪页。在原生 Modal 里选图时要渲染进那个 Modal，并排的两个 Modal 在 iOS 上弹不出来。 */
  cropper: ReactNode;
}

export function useImageCropStep(shape: ImageCropShape): ImageCropStep {
  const [pending, setPending] = useState<PendingCrop | null>(null);

  const cropIfNeeded = useCallback(async (asset: ImagePickerAsset) => {
    if (Platform.OS !== 'ios') return asset;
    // PHPicker 的结果可能在关闭动画结束前就回到 JS；这时呈现 Modal 会被 UIKit 丢弃且不重试，
    // 裁剪页永远不出来。这段等待只发生在选完图之后，不影响相册弹出速度。
    await new Promise((resolve) => setTimeout(resolve, PICKER_DISMISS_SETTLE_MS));
    return new Promise<ImagePickerAsset | null>((resolve) => setPending({ asset, resolve }));
  }, []);

  const finish = (asset: ImagePickerAsset | null) => {
    pending?.resolve(asset);
    setPending(null);
  };

  return {
    cropIfNeeded,
    cropper: pending ? <ImageCropModal asset={pending.asset} shape={shape} onCancel={() => finish(null)} onCropped={finish} /> : null,
  };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.sm },
  headerSide: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  confirm: { alignItems: 'flex-end' },
  title: { ...Typography.h3, color: '#FFFFFF', flex: 1, textAlign: 'center' },
  action: { ...Typography.body, color: '#FFFFFF' },
  preview: { flex: 1 },
  busy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },
});
