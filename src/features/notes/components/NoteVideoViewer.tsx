import { UploadProgressHost } from '@/components/app/UploadProgressHost';
import { ViewerVideoPage } from '@/components/ui/viewer-video-page';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Spacing } from '@/theme';

const noop = () => {};

/**
 * 笔记里的视频全屏播放。和聊天的全屏查看器用同一个播放器(ViewerVideoPage):控件条贴在
 * 底部,点画面暂停/继续,下滑关闭。不用系统控件 —— 它会把按钮摆在画面正中。
 * 只为选中的那个视频挂载;播放器随卸载释放。
 */
export function NoteVideoViewer({ uri, onClose, onMediaError }: { uri: string; onClose: () => void; onMediaError?: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.fullscreen}>
        <StatusBar style="light" />
        <ViewerVideoPage
          videoUrl={uri}
          ephemeral={false}
          width={width}
          height={height}
          autoPlay
          // 只有一个视频,没有可翻的页。
          onPagerLockChange={noop}
          onSwipeDown={onClose}
          onMediaError={onMediaError}
        />
        <Pressable
          style={[s.closeButton, { top: insets.top + Spacing.sm }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <UploadProgressHost />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fullscreen: { flex: 1, backgroundColor: '#000' },
  closeButton: {
    position: 'absolute',
    right: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
