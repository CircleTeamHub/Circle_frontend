import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import {
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  section: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.md,
  },
});

export default function ChatBackgroundScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    conversationID?: string;
    title?: string;
  }>();

  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';

  const backgroundPreference = useChatPreferencesStore(
    (state) => state.backgroundsByConversationID[conversationID],
  );
  const setChatBackgroundPreference = useChatPreferencesStore(
    (state) => state.setChatBackgroundPreference,
  );
  const [uploadingImage, setUploadingImage] = useState(false);
  const customImageStatusText = useMemo(
    () =>
      uploadingImage
        ? '上传中...'
        : backgroundPreference?.mode === 'image'
          ? '已设置'
          : '请选择',
    [backgroundPreference?.mode, uploadingImage],
  );

  const handlePickCustomImage = useCallback(async () => {
    if (!conversationID) {
      Alert.alert('参数缺失', '无法修改当前会话的聊天背景。');
      return;
    }
    if (uploadingImage) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    setUploadingImage(true);
    try {
      const fileName =
        asset.fileName ?? asset.uri.split('/').pop() ?? 'chat-background.jpg';
      const contentType =
        resolveUploadContentType({
          mimeType: asset.mimeType,
          fileName,
        }) ?? 'image/jpeg';
      const presign = await requestUploadPresign({
        filename: sanitizeUploadFilename(fileName),
        contentType,
        folder: 'chat',
      });

      await uploadLocalFileToPresignedUrl(
        presign.uploadUrl,
        contentType,
        asset.uri,
      );
      setUploadingImage(false);
      setChatBackgroundPreference(conversationID, {
        mode: 'image',
        uri: presign.fileUrl,
      });
      router.back();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '图片背景设置失败，请重试。';
      setUploadingImage(false);
      Alert.alert('设置失败', message);
    }
  }, [conversationID, setChatBackgroundPreference, uploadingImage]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
      <NavHeader title="聊天背景" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, { backgroundColor: colors.surface }]}>
          <MenuRow
            icon="image-outline"
            label="自定义图片"
            rightText={customImageStatusText}
            onPress={handlePickCustomImage}
          />
        </View>
      </ScrollView>
    </View>
  );
}
