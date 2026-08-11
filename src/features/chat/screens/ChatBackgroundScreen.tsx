import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationID?: string;
    title?: string;
  }>();

  // Guard against setState after the screen unmounts mid-upload.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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
        ? t('chat.background.statusUploading')
        : backgroundPreference?.mode === 'image'
          ? t('chat.background.statusSet')
          : t('chat.background.statusChoose'),
    [backgroundPreference?.mode, uploadingImage, t],
  );

  const handlePickCustomImage = useCallback(async () => {
    if (!conversationID) {
      Alert.alert(
        t('chat.background.paramMissing'),
        t('chat.background.cannotModify'),
      );
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
        fileUri: asset.uri,
      });

      await uploadLocalFileToPresignedUrl(
        presign.uploadUrl,
        contentType,
        asset.uri,
      );
      if (!mountedRef.current) return;
      setUploadingImage(false);
      setChatBackgroundPreference(conversationID, {
        mode: 'image',
        uri: presign.fileUrl,
      });
      router.back();
    } catch {
      if (!mountedRef.current) return;
      setUploadingImage(false);
      Alert.alert(
        t('chat.background.failedTitle'),
        t('chat.background.failedBody'),
      );
    }
  }, [conversationID, setChatBackgroundPreference, uploadingImage, t]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
      <NavHeader title={t('chat.background.title')} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, { backgroundColor: colors.surface }]}>
          <MenuRow
            icon="image-outline"
            label={t('chat.background.customImage')}
            rightText={customImageStatusText}
            onPress={handlePickCustomImage}
          />
        </View>
      </ScrollView>
    </View>
  );
}
