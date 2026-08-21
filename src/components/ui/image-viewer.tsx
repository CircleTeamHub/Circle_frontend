import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ZoomableImage } from '@/components/ui/zoomable-image';
import { saveImageToLibrary } from '@/utils/save-image';
import { Spacing, Typography } from '@/theme';

/**
 * 全屏大图查看器：黑底、按比例完整显示、多图左右翻页。
 *
 * 触摸端靠分页滚动翻页；web 没有滑动手势，额外给左右箭头（键盘 ← → 同样
 * 可用）。ESC / 返回键经 Modal 的 onRequestClose 关闭，点图片本身也关闭
 * （与微信一致）。
 *
 * 缩放与长按保存由 ZoomableImage / save-image 承担（均为零新增依赖的
 * 自绘方案，见各自文件头）。
 */
interface ImageViewerProps {
  images: string[];
  visible: boolean;
  initialIndex?: number;
  onClose: () => void;
}

export function ImageViewer({
  images,
  visible,
  initialIndex = 0,
  onClose,
}: ImageViewerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(initialIndex);
  // 放大态下禁掉列表横滑，否则平移会被翻页抢走。
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);

  // 每次打开都从被点的那张开始（组件常驻挂载，不靠 remount 复位）。
  useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setZoomed(false);
    }
  }, [visible, initialIndex]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(images.length - 1, next));
      setIndex(clamped);
      listRef.current?.scrollToIndex({ index: clamped, animated: true });
    },
    [images.length],
  );

  // Web：键盘左右翻页 / ESC 关闭（Modal 自己只处理 ESC 的部分实现）。
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goTo(index - 1);
      else if (event.key === 'ArrowRight') goTo(index + 1);
      else if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, onClose, visible]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const outcome = await saveImageToLibrary(images[index]);
      if (outcome === 'denied') {
        Alert.alert(t('media.saveDeniedTitle'), t('media.saveDeniedMessage'));
      } else if (outcome === 'failed') {
        Alert.alert(t('media.saveFailedTitle'), t('media.saveFailedMessage'));
      } else if (Platform.OS !== 'web') {
        // web 由浏览器自己的下载提示反馈，不再叠一层弹窗。
        Alert.alert(t('media.savedTitle'), t('media.savedMessage'));
      }
    } finally {
      setSaving(false);
    }
  }, [images, index, saving, t]);

  const handleLongPress = useCallback(() => {
    Alert.alert('', '', [
      { text: t('media.saveImage'), onPress: () => void handleSave() },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }, [handleSave, t]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      setIndex(Math.max(0, Math.min(images.length - 1, next)));
    },
    [images.length, width],
  );

  if (images.length === 0) return null;

  const showArrows = Platform.OS === 'web' && images.length > 1;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.root}>
        <FlatList
          ref={listRef}
          data={images}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!zoomed}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          onMomentumScrollEnd={handleMomentumEnd}
          renderItem={({ item, index: itemIndex }) => (
            <ZoomableImage
              uri={item}
              width={width}
              height={height}
              active={itemIndex === index}
              onZoomedChange={setZoomed}
              // 单击关闭：全屏查看器里最顺手的退出方式（双击留给放大）。
              onTap={onClose}
              onLongPress={handleLongPress}
            />
          )}
        />

        <Pressable
          style={[s.closeButton, { top: insets.top + Spacing.md }]}
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>

        {images.length > 1 ? (
          <View style={[s.counter, { top: insets.top + Spacing.md }]}>
            <Text style={s.counterText}>{`${index + 1} / ${images.length}`}</Text>
          </View>
        ) : null}

        {showArrows ? (
          <>
            <Pressable
              style={[s.arrow, s.arrowLeft, index === 0 && s.arrowDisabled]}
              onPress={() => goTo(index - 1)}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel={t('common.previous', { defaultValue: '上一张' })}
            >
              <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={[
                s.arrow,
                s.arrowRight,
                index === images.length - 1 && s.arrowDisabled,
              ]}
              onPress={() => goTo(index + 1)}
              disabled={index === images.length - 1}
              accessibilityRole="button"
              accessibilityLabel={t('common.next', { defaultValue: '下一张' })}
            >
              <Ionicons name="chevron-forward" size={28} color="#FFFFFF" />
            </Pressable>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  closeButton: {
    position: 'absolute',
    left: Spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  counterText: {
    ...Typography.body,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  arrowLeft: { left: Spacing.lg },
  arrowRight: { right: Spacing.lg },
  arrowDisabled: { opacity: 0.25 },
});
