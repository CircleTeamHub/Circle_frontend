import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import {
  FlipType,
  manipulateAsync,
  SaveFormat,
  type Action,
} from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, Radius, Spacing, Typography } from '@/theme';
import { FreePhotoCropper } from '@/features/chat/components/free-photo-cropper';
import {
  PhotoMarkupEditor,
  type PhotoMarkupEditorHandle,
} from '@/features/chat/components/photo-markup-editor';
import type { PhotoCropRect } from '@/features/chat/utils/photo-editor';
import type { PhotoMarkupTool } from '@/features/chat/utils/photo-markup';

interface PhotoEditorModalProps {
  asset: ImagePickerAsset | null;
  onCancel: () => void;
  onSend: (asset: ImagePickerAsset) => Promise<boolean>;
}

interface EditTool {
  id: 'crop' | 'mosaic' | 'draw' | 'rotate' | 'flip' | 'reset';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}

const DRAW_COLORS = ['#FFFFFF', '#111111', '#FF3B30', '#FFD60A', '#34C759', '#0A84FF'];

function buildEditedFilename(originalName: string | null | undefined, format: SaveFormat) {
  const extension = format === SaveFormat.PNG ? 'png' : 'jpg';
  const stem = originalName?.replace(/\.[^./]+$/, '') || 'photo';
  return `${stem}-edited.${extension}`;
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  headerSide: {
    width: 76,
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelText: {
    ...Typography.body,
    color: '#FFFFFF',
  },
  title: {
    ...Typography.h3,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
  sendButton: {
    alignSelf: 'flex-end',
    minHeight: 38,
    minWidth: 64,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    ...Typography.body,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  preview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  toolsViewport: {
    flexGrow: 0,
  },
  tools: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  tool: {
    width: 54,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  toolIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.34)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toolLabel: {
    ...Typography.small,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  cropHint: {
    minHeight: 70,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropHintText: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
  },
  markupControls: {
    minHeight: 104,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markupControlRow: {
    minHeight: 42,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  modeButton: {
    minHeight: 38,
    minWidth: 92,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.34)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  modeButtonText: {
    ...Typography.small,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  colorButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.52)',
  },
  undoButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});

export function PhotoEditorModal({
  asset,
  onCancel,
  onSend,
}: PhotoEditorModalProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [workingAsset, setWorkingAsset] = useState<ImagePickerAsset | null>(asset);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<PhotoCropRect | null>(null);
  const [markupMode, setMarkupMode] = useState<PhotoMarkupTool | null>(null);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[2]);
  const [markupCanUndo, setMarkupCanUndo] = useState(false);
  const [markupReady, setMarkupReady] = useState(false);
  const markupRef = useRef<PhotoMarkupEditorHandle>(null);
  const submitLockRef = useRef(false);

  useEffect(() => {
    setWorkingAsset(asset);
    setBusy(false);
    setSubmitting(false);
    setCropMode(false);
    setPendingCrop(null);
    setMarkupMode(null);
    setMarkupCanUndo(false);
    setMarkupReady(false);
    submitLockRef.current = false;
  }, [asset]);

  const vibrate = useCallback(() => {
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.selectionAsync();
    }
  }, []);

  const applyEdit = useCallback(
    async (actions: Action[]) => {
      if (!asset || !workingAsset || busy || submitting) return false;
      vibrate();
      setBusy(true);
      try {
        const preservePng =
          workingAsset.mimeType === 'image/png' ||
          workingAsset.fileName?.toLowerCase().endsWith('.png');
        const format = preservePng ? SaveFormat.PNG : SaveFormat.JPEG;
        const result = await manipulateAsync(workingAsset.uri, actions, {
          compress: preservePng ? 1 : 0.92,
          format,
        });
        // Web 没有文件系统可 stat（getInfoAsync 直接抛），fileSize 留空 ——
        // 上传前 presign 侧会从 blob 现取字节数，这里只是元数据。
        const info =
          Platform.OS === 'web'
            ? null
            : await FileSystem.getInfoAsync(result.uri);
        setWorkingAsset({
          ...workingAsset,
          uri: result.uri,
          width: result.width,
          height: result.height,
          type: 'image',
          fileName: buildEditedFilename(asset.fileName, format),
          fileSize: info?.exists ? info.size : undefined,
          mimeType: preservePng ? 'image/png' : 'image/jpeg',
          assetId: null,
          base64: null,
          exif: null,
          pairedVideoAsset: null,
        });
        return true;
      } catch {
        Alert.alert(
          t('chat.photoEditor.editFailedTitle', { defaultValue: '编辑失败' }),
          t('chat.photoEditor.editFailedMessage', {
            defaultValue: '照片处理失败，请重试',
          }),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [asset, busy, submitting, t, vibrate, workingAsset],
  );

  const exitCropMode = useCallback(() => {
    if (busy) return;
    setCropMode(false);
    setPendingCrop(null);
  }, [busy]);

  const handleApplyCrop = useCallback(async () => {
    if (!pendingCrop || busy) return;
    const applied = await applyEdit([{ crop: pendingCrop }]);
    if (applied) {
      setCropMode(false);
      setPendingCrop(null);
    }
  }, [applyEdit, busy, pendingCrop]);

  const enterMarkupMode = useCallback(
    (mode: PhotoMarkupTool) => {
      setMarkupMode(mode);
      setMarkupCanUndo(false);
      setMarkupReady(false);
      vibrate();
    },
    [vibrate],
  );

  const exitMarkupMode = useCallback(() => {
    if (busy) return;
    setMarkupMode(null);
    setMarkupCanUndo(false);
    setMarkupReady(false);
  }, [busy]);

  const handleApplyMarkup = useCallback(async () => {
    if (!asset || !workingAsset || busy || submitting || !markupRef.current) return;
    vibrate();
    setBusy(true);
    try {
      const result = await markupRef.current.exportImage();
      if (!result) return;
      const extension = result.mimeType === 'image/png' ? 'png' : 'jpg';
      const stem = asset.fileName?.replace(/\.[^./]+$/, '') || 'photo';
      setWorkingAsset({
        ...workingAsset,
        uri: result.uri,
        width: result.width,
        height: result.height,
        type: 'image',
        fileName: `${stem}-edited.${extension}`,
        fileSize: result.fileSize,
        mimeType: result.mimeType,
        assetId: null,
        base64: null,
        exif: null,
        pairedVideoAsset: null,
      });
      setMarkupMode(null);
      setMarkupCanUndo(false);
      setMarkupReady(false);
    } catch {
      Alert.alert(
        t('chat.photoEditor.editFailedTitle', { defaultValue: '编辑失败' }),
        t('chat.photoEditor.editFailedMessage', {
          defaultValue: '照片处理失败，请重试',
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [asset, busy, submitting, t, vibrate, workingAsset]);

  const isDirty = Boolean(asset && workingAsset && asset.uri !== workingAsset.uri);
  const tools = useMemo<EditTool[]>(() => {
    const allTools: EditTool[] = [
      {
        id: 'crop',
        icon: 'crop-outline',
        label: t('chat.photoEditor.freeCrop', { defaultValue: '自由裁剪' }),
        onPress: () => {
          setPendingCrop(null);
          setCropMode(true);
          vibrate();
        },
      },
      {
        id: 'mosaic',
        icon: 'grid-outline',
        label: t('chat.photoEditor.mosaic', { defaultValue: '马赛克' }),
        onPress: () => enterMarkupMode('mosaic'),
      },
      {
        id: 'draw',
        icon: 'pencil-outline',
        label: t('chat.photoEditor.draw', { defaultValue: '涂鸦' }),
        onPress: () => enterMarkupMode('draw'),
      },
      {
        id: 'rotate',
        icon: 'refresh-outline',
        label: t('chat.photoEditor.rotate', { defaultValue: '旋转' }),
        onPress: () => void applyEdit([{ rotate: 90 }]),
      },
      {
        id: 'flip',
        icon: 'swap-horizontal-outline',
        label: t('chat.photoEditor.flip', { defaultValue: '镜像' }),
        onPress: () => void applyEdit([{ flip: FlipType.Horizontal }]),
      },
      {
        id: 'reset',
        icon: 'return-up-back-outline',
        label: t('chat.photoEditor.reset', { defaultValue: '还原' }),
        disabled: !isDirty,
        onPress: () => {
          if (!asset) return;
          vibrate();
          setWorkingAsset(asset);
        },
      },
    ];
    // Web：涂鸦/马赛克依赖 Skia 画布，web 档是占位桩（见
    // photo-markup-editor.web.tsx），入口直接不放出；裁剪/旋转/镜像
    // 走 expo-image-manipulator，web 可用，保留。
    return Platform.OS === 'web'
      ? allTools.filter((tool) => tool.id !== 'mosaic' && tool.id !== 'draw')
      : allTools;
  },
    [applyEdit, asset, enterMarkupMode, isDirty, t, vibrate],
  );

  const handleCancel = useCallback(() => {
    if (busy || submitting) return;
    onCancel();
  }, [busy, onCancel, submitting]);

  const handleSend = useCallback(async () => {
    if (!workingAsset || busy || submitting || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    vibrate();
    try {
      await onSend(workingAsset);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [busy, onSend, submitting, vibrate, workingAsset]);

  const editorLocked = busy || submitting;
  // asset 从 null 切到已选照片后的第一帧，effect 尚未同步 workingAsset；直接回退到
  // prop，避免全屏编辑器打开时短暂闪一帧黑屏。
  const previewAsset = workingAsset ?? asset;
  const headerTitle = cropMode
    ? t('chat.photoEditor.freeCropTitle', { defaultValue: '自由裁剪' })
    : markupMode === 'mosaic'
      ? t('chat.photoEditor.mosaicTitle', { defaultValue: '马赛克' })
      : markupMode === 'draw'
        ? t('chat.photoEditor.drawTitle', { defaultValue: '涂鸦' })
    : t('chat.photoEditor.title', { defaultValue: '编辑照片' });
  const editingSubtool = cropMode || markupMode !== null;
  const headerActionLabel = editingSubtool
    ? t('chat.photoEditor.cropDone', { defaultValue: '完成' })
    : t('common.send');
  const headerActionDisabled =
    editorLocked ||
    (cropMode
      ? !pendingCrop
      : markupMode
        ? !markupReady || !markupCanUndo
        : !workingAsset);
  const exitSubtool = cropMode ? exitCropMode : markupMode ? exitMarkupMode : handleCancel;

  return (
    <Modal
      visible={asset !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={exitSubtool}
    >
      <StatusBar style="light" />
      <View
        style={[
          s.root,
          {
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, Spacing.sm),
          },
        ]}
      >
        <View style={s.header}>
          <Pressable
            style={s.headerSide}
            onPress={exitSubtool}
            disabled={editorLocked}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <Text style={[s.cancelText, editorLocked && { opacity: 0.45 }]}>
              {t('common.cancel')}
            </Text>
          </Pressable>
          <Text style={s.title} numberOfLines={1}>
            {headerTitle}
          </Text>
          <View style={[s.headerSide, { alignItems: 'flex-end' }]}>
            <Pressable
              style={[
                s.sendButton,
                { backgroundColor: colors.primary },
                headerActionDisabled && { opacity: 0.45 },
              ]}
              onPress={() => {
                if (cropMode) {
                  void handleApplyCrop();
                } else if (markupMode) {
                  void handleApplyMarkup();
                } else {
                  void handleSend();
                }
              }}
              disabled={headerActionDisabled}
              accessibilityRole="button"
              accessibilityLabel={headerActionLabel}
            >
              {editorLocked ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={s.sendText}>{headerActionLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>

        <View style={s.preview}>
          {previewAsset && cropMode ? (
            <FreePhotoCropper
              asset={previewAsset}
              onCropChange={setPendingCrop}
              accessibilityLabel={t('chat.photoEditor.cropFrame', {
                defaultValue: '自由裁剪框',
              })}
            />
          ) : previewAsset && markupMode ? (
            <PhotoMarkupEditor
              key={previewAsset.uri}
              ref={markupRef}
              asset={previewAsset}
              tool={markupMode}
              color={drawColor}
              onCanUndoChange={setMarkupCanUndo}
              onReadyChange={setMarkupReady}
              accessibilityLabel={t('chat.photoEditor.markupCanvas', {
                defaultValue: '照片编辑画布',
              })}
            />
          ) : previewAsset ? (
            <Image
              source={{ uri: previewAsset.uri }}
              style={s.image}
              contentFit="contain"
              accessibilityLabel={t('chat.photoEditor.preview', {
                defaultValue: '待发送照片预览',
              })}
            />
          ) : null}
          {busy ? (
            <View style={s.busyOverlay} pointerEvents="auto">
              <ActivityIndicator size="large" color="#FFFFFF" />
            </View>
          ) : null}
        </View>

        {cropMode ? (
          <View style={s.cropHint}>
            <Text style={s.cropHintText}>
              {t('chat.photoEditor.cropHint', {
                defaultValue: '拖动四角调整范围，拖动框内移动位置',
              })}
            </Text>
          </View>
        ) : markupMode ? (
          <View style={s.markupControls}>
            <View style={s.markupControlRow}>
              <Pressable
                style={[
                  s.modeButton,
                  markupMode === 'mosaic' && { backgroundColor: colors.primary },
                ]}
                onPress={() => {
                  setMarkupMode('mosaic');
                  vibrate();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: markupMode === 'mosaic' }}
                accessibilityLabel={t('chat.photoEditor.mosaic', {
                  defaultValue: '马赛克',
                })}
              >
                <Ionicons name="grid-outline" size={19} color="#FFFFFF" />
                <Text style={s.modeButtonText}>
                  {t('chat.photoEditor.mosaic', { defaultValue: '马赛克' })}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  s.modeButton,
                  markupMode === 'draw' && { backgroundColor: colors.primary },
                ]}
                onPress={() => {
                  setMarkupMode('draw');
                  vibrate();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: markupMode === 'draw' }}
                accessibilityLabel={t('chat.photoEditor.draw', {
                  defaultValue: '涂鸦',
                })}
              >
                <Ionicons name="pencil-outline" size={19} color="#FFFFFF" />
                <Text style={s.modeButtonText}>
                  {t('chat.photoEditor.draw', { defaultValue: '涂鸦' })}
                </Text>
              </Pressable>
            </View>
            <View style={s.markupControlRow}>
              {markupMode === 'draw'
                ? DRAW_COLORS.map((color) => (
                    <Pressable
                      key={color}
                      style={[
                        s.colorButton,
                        drawColor === color && {
                          borderWidth: 2,
                          borderColor: '#FFFFFF',
                        },
                      ]}
                      onPress={() => {
                        setDrawColor(color);
                        vibrate();
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: drawColor === color }}
                      accessibilityLabel={t('chat.photoEditor.drawColor', {
                        defaultValue: '画笔颜色',
                      })}
                    >
                      <View style={[s.colorSwatch, { backgroundColor: color }]} />
                    </Pressable>
                  ))
                : (
                    <Text style={s.cropHintText}>
                      {t('chat.photoEditor.mosaicHint', {
                        defaultValue: '手指滑动涂抹需要隐藏的区域',
                      })}
                    </Text>
                  )}
              <Pressable
                style={[s.undoButton, !markupCanUndo && { opacity: 0.35 }]}
                onPress={() => {
                  markupRef.current?.undo();
                  vibrate();
                }}
                disabled={!markupCanUndo}
                accessibilityRole="button"
                accessibilityLabel={t('chat.photoEditor.undo', {
                  defaultValue: '撤销',
                })}
                accessibilityState={{ disabled: !markupCanUndo }}
              >
                <Ionicons name="arrow-undo-outline" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView
            horizontal
            bounces={false}
            showsHorizontalScrollIndicator={false}
            style={s.toolsViewport}
            contentContainerStyle={s.tools}
          >
            {tools.map((tool) => {
              const disabled = editorLocked || tool.disabled;
              return (
                <Pressable
                  key={tool.id}
                  style={[s.tool, disabled && { opacity: 0.4 }]}
                  onPress={tool.onPress}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={tool.label}
                  accessibilityState={{ disabled }}
                >
                  <View style={s.toolIcon}>
                    <Ionicons name={tool.icon} size={23} color="#FFFFFF" />
                  </View>
                  <Text style={s.toolLabel} numberOfLines={2}>
                    {tool.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
