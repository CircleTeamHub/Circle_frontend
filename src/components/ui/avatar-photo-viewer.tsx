import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView,
  StatusBar, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { ZoomableImage } from '@/components/ui/zoomable-image';
import type { AvatarImageSource } from '@/hooks/use-change-avatar';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { saveImageToLibrary } from '@/utils/save-image';

interface Props {
  visible: boolean;
  uri?: string | null;
  name: string;
  changing?: boolean;
  onChange?: (source: AvatarImageSource) => Promise<void> | void;
  onClose: () => void;
}

export function AvatarPhotoViewer({ visible, uri, name, changing = false, onChange, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [menuVisible, setMenuVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const activeRef = useRef(visible);

  useEffect(() => {
    activeRef.current = visible;
    if (!visible) setMenuVisible(false);
    return () => { activeRef.current = false; };
  }, [visible]);

  async function save() {
    if (!uri || savingRef.current || changing) return;
    savingRef.current = true;
    setSaving(true);
    setMenuVisible(false);
    try {
      const outcome = await saveImageToLibrary(uri);
      if (!activeRef.current) return;
      if (outcome === 'denied') {
        Alert.alert(t('media.saveDeniedTitle'), t('media.saveDeniedMessage'));
      } else if (outcome === 'failed') {
        Alert.alert(t('media.saveFailedTitle'), t('media.saveFailedMessage'));
      } else if (Platform.OS !== 'web') {
        Alert.alert(t('media.savedTitle'), t('media.savedMessage'));
      }
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  }

  function choose(source: AvatarImageSource) {
    setMenuVisible(false);
    if (!changing && !savingRef.current) void onChange?.(source);
  }

  if (!visible) return null;
  const busy = changing || saving;
  const imageHeight = Math.max(1, height - insets.top - insets.bottom - 56);

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={menuVisible ? () => setMenuVisible(false) : onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View
          testID="avatar-photo-content"
          style={s.content}
          aria-hidden={menuVisible}
          importantForAccessibility={menuVisible ? 'no-hide-descendants' : 'auto'}
        >
          <View style={s.header}>
            <Pressable style={s.headerButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.back')}>
              <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
            </Pressable>
            <Text style={s.title} numberOfLines={1}>{t('avatarPhoto.title')}</Text>
            <Pressable style={s.headerButton} onPress={() => setMenuVisible(true)} accessibilityRole="button" accessibilityLabel={t('avatarPhoto.actions')}>
              <Ionicons name="ellipsis-horizontal" size={26} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={s.imageArea}>
            {uri ? (
              <ZoomableImage key={uri} uri={uri} width={width} height={imageHeight} active={!menuVisible} onSwipeDown={onClose} />
            ) : <Avatar size={Math.min(width, 240)} name={name} />}
          </View>
          {busy ? <ActivityIndicator style={s.progress} color="#FFFFFF" accessibilityLabel={t('common.loading')} /> : null}
        </View>
        {/* 与大图共用原生 Modal，避免 iOS 再呈现一个 Modal 时菜单无法显示。 */}
        {menuVisible ? (
          <View style={StyleSheet.absoluteFill} testID="avatar-photo-actions">
            <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={() => setMenuVisible(false)} accessible={false} />
            <View style={[s.sheet, { backgroundColor: colors.surface }]} accessibilityViewIsModal>
              <ScrollView bounces={false} style={{ maxHeight: height - insets.top }} contentContainerStyle={{ paddingBottom: insets.bottom || Spacing.lg }}>
                {onChange ? (
                  <>
                    <Pressable style={s.action} disabled={busy} onPress={() => choose('camera')} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
                      <Text style={[s.actionLabel, { color: busy ? colors.textSecondary : colors.text }]}>{t('avatarPhoto.takePhoto')}</Text>
                    </Pressable>
                    <View style={[s.divider, { backgroundColor: colors.divider }]} />
                    <Pressable style={s.action} disabled={busy} onPress={() => choose('library')} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
                      <Text style={[s.actionLabel, { color: busy ? colors.textSecondary : colors.text }]}>{t('avatarPhoto.chooseFromPhotos')}</Text>
                    </Pressable>
                    <View style={[s.divider, { backgroundColor: colors.divider }]} />
                  </>
                ) : null}
                <Pressable style={s.action} disabled={busy || !uri} onPress={() => void save()} accessibilityRole="button" accessibilityState={{ disabled: busy || !uri }}>
                  <Text style={[s.actionLabel, { color: busy || !uri ? colors.textSecondary : colors.text }]}>{t('media.saveImage')}</Text>
                </Pressable>
                <View style={[s.cancelGap, { backgroundColor: colors.background }]} />
                <Pressable style={s.action} onPress={() => setMenuVisible(false)} accessibilityRole="button">
                  <Text style={[s.actionLabel, { color: colors.text }]}>{t('common.cancel')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { flex: 1 },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.h3, color: '#FFFFFF', textAlign: 'center', flex: 1 },
  imageArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progress: { position: 'absolute', bottom: Spacing.lg, alignSelf: 'center' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, overflow: 'hidden' },
  action: { minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  actionLabel: { ...Typography.body, textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth },
  cancelGap: { height: Spacing.sm },
});
