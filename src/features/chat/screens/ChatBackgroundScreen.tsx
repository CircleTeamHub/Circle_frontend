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
  collectChatBackgroundImageUris,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import {
  persistChatBackgroundImage,
  pruneChatBackgroundImages,
} from '@/features/chat/utils/chat-background-image';
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
    scope?: string;
  }>();

  // Guard against setState after the screen unmounts mid-apply.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const isGlobal = params.scope === 'global';

  const backgroundPreference = useChatPreferencesStore((state) =>
    isGlobal
      ? state.globalBackgroundPreference ?? undefined
      : state.backgroundsByConversationID[conversationID],
  );
  const setChatBackgroundPreference = useChatPreferencesStore(
    (state) => state.setChatBackgroundPreference,
  );
  const setGlobalBackgroundPreference = useChatPreferencesStore(
    (state) => state.setGlobalBackgroundPreference,
  );
  const [applyingImage, setApplyingImage] = useState(false);
  const customImageStatusText = useMemo(
    () =>
      applyingImage
        ? t('chat.background.statusApplying')
        : backgroundPreference?.mode === 'image'
          ? t('chat.background.statusSet')
          : t('chat.background.statusChoose'),
    [backgroundPreference?.mode, applyingImage, t],
  );

  // mode 'global' means "defer to the layer above" for a conversation and "no
  // custom background" for the global preference, so both clear the same way.
  const hasBackground = Boolean(
    backgroundPreference && backgroundPreference.mode !== 'global',
  );

  const handleRestoreDefault = useCallback(() => {
    if (applyingImage) return;
    if (isGlobal) {
      setGlobalBackgroundPreference({ mode: 'global' });
    } else {
      if (!conversationID) return;
      setChatBackgroundPreference(conversationID, { mode: 'global' });
    }
    pruneChatBackgroundImages(collectChatBackgroundImageUris());
    router.back();
  }, [
    conversationID,
    isGlobal,
    setChatBackgroundPreference,
    setGlobalBackgroundPreference,
    applyingImage,
  ]);

  const handlePickCustomImage = useCallback(async () => {
    if (!isGlobal && !conversationID) {
      Alert.alert(
        t('chat.background.paramMissing'),
        t('chat.background.cannotModify'),
      );
      return;
    }
    if (applyingImage) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    setApplyingImage(true);
    try {
      // The image stays on this device. The preference itself only ever lives
      // in MMKV and the server never reads it, so there was never a reason to
      // upload. Uploading to the `chat/` prefix and keeping the direct URL is
      // exactly what turned the message area grey: that prefix denies anonymous
      // reads, so the stored URL was a permanent 403.
      const uri = await persistChatBackgroundImage(
        asset.uri,
        asset.width ?? undefined,
      );
      if (!mountedRef.current) return;
      setApplyingImage(false);
      const preference = { mode: 'image' as const, uri };
      if (isGlobal) {
        setGlobalBackgroundPreference(preference);
      } else {
        setChatBackgroundPreference(conversationID, preference);
      }
      // The replaced image has no referrer left; drop it so the directory does
      // not grow with every background change.
      pruneChatBackgroundImages(collectChatBackgroundImageUris());
      router.back();
    } catch {
      if (!mountedRef.current) return;
      setApplyingImage(false);
      Alert.alert(
        t('chat.background.failedTitle'),
        t('chat.background.failedBody'),
      );
    }
  }, [
    conversationID,
    isGlobal,
    setChatBackgroundPreference,
    setGlobalBackgroundPreference,
    applyingImage,
    t,
  ]);

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
          {/* Picking an image was the only action here, and the store clears a
              background only when it receives a 'global' preference, which
              nothing on screen ever sent. So once set, the default was
              unreachable. */}
          {hasBackground ? (
            <MenuRow
              icon="refresh-outline"
              label={t('chat.background.restoreDefault')}
              onPress={handleRestoreDefault}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
