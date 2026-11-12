import { memo, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Platform, Alert, AppState, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography } from '@/theme';
import { EMOJI_GROUPS } from '@/constants/emojis';
import { BottomSheetScrollView } from '@/components/ui/bottom-sheet-modal';
import { launchImageLibraryFast } from '@/features/profile/image-picker';
import { useStickerStore } from '@/features/chat/store/use-sticker-store';
import { useAuthStore } from '@/stores/authStore';
import type { CustomSticker } from '@/services/api/stickers';
import { requestUploadPresign, resolveLocalFileSize, resolveUploadContentType, sanitizeUploadFilename, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { getStickerErrorMessage } from '@/features/chat/utils/sticker-error';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onSelectSticker?: (sticker: CustomSticker) => void;
}

const emojiFontFamily = Platform.select({
  ios: 'Apple Color Emoji',
  android: 'Noto Color Emoji',
  default: undefined,
});

const s = StyleSheet.create({
  container: {
    height: 240,
  },
  tabs: { flexGrow: 0 },
  tabContent: { paddingHorizontal: Spacing.md, gap: Spacing.xs, alignItems: 'center' },
  tab: { width: 48, height: 44, marginVertical: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabEmoji: { fontSize: 24, fontFamily: emojiFontFamily },
  pager: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  groupLabel: {
    ...Typography.small,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '12.5%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 26,
    fontFamily: emojiFontFamily,
  },
  stickerCell: { width: '20%', height: 76, padding: Spacing.xs },
  stickerImage: { width: '100%', height: 58 },
  removeSticker: { position: 'absolute', right: 0, top: 0, minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  addSticker: { height: 58, alignItems: 'center', justifyContent: 'center' },
});

export const EmojiPicker = memo(function EmojiPicker({ onSelect, onSelectSticker }: EmojiPickerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { items, loading, error, refresh } = useStickerStore();
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const mounted = useRef(false);
  const addingRef = useRef(false);
  const [adding, setAdding] = useState(false);
  const customEnabled = Boolean(onSelectSticker);
  const pages = customEnabled ? [EMOJI_GROUPS[0], null, ...EMOJI_GROUPS.slice(1)] : EMOJI_GROUPS;
  const [activePage, setActivePage] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const pagerRef = useRef<ScrollView>(null);
  const tabsRef = useRef<ScrollView>(null);
  const selectPage = (index: number, scroll = true) => {
    setActivePage(index);
    tabsRef.current?.scrollTo({ x: index * (48 + Spacing.xs), animated: true });
    if (scroll) pagerRef.current?.scrollTo({ x: index * pageWidth, animated: true });
  };
  useEffect(() => {
    if (!customEnabled) return;
    mounted.current = true;
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { mounted.current = false; subscription.remove(); };
  }, [customEnabled, refresh, sessionEpoch]);

  const handleAddSticker = async () => {
    if (addingRef.current) return;
    if (items.length >= 200) { Alert.alert(t('chat.stickers.limitReached')); return; }
    const epoch = useAuthStore.getState().sessionEpoch;
    const current = () => mounted.current && useAuthStore.getState().sessionEpoch === epoch;
    addingRef.current = true; setAdding(true);
    try {
      const outcome = await launchImageLibraryFast(ImagePicker, { mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
      if (!current()) return;
      if (outcome.status === 'denied') { Alert.alert(t('chat.stickers.permissionDenied')); return; }
      if (outcome.result.canceled || !outcome.result.assets[0]) return;
      const asset = outcome.result.assets[0];
      const contentType = resolveUploadContentType({ mimeType: asset.mimeType, fileName: asset.fileName });
      if (!contentType?.startsWith('image/')) { Alert.alert(t('chat.stickers.unsupportedImage')); return; }
      let prepared = { uri: asset.uri, contentType, filename: asset.fileName || 'sticker', width: asset.width, height: asset.height };
      if (contentType !== 'image/gif') {
        const keepAlpha = contentType === 'image/png' || contentType === 'image/webp';
        const resize = Math.max(asset.width, asset.height) > 2048
          ? [{ resize: asset.width >= asset.height ? { width: 2048 } : { height: 2048 } }]
          : [];
        // Re-encode static images to strip EXIF/GPS. PNG preserves sticker alpha;
        // GIF stays intact to preserve animation. Failure must not upload originals.
        const image = await manipulateAsync(asset.uri, resize, { format: keepAlpha ? SaveFormat.PNG : SaveFormat.JPEG, compress: 0.85 });
        prepared = { ...image, contentType: keepAlpha ? 'image/png' : 'image/jpeg', filename: `${prepared.filename.replace(/\.[^/.]+$/, '')}.${keepAlpha ? 'png' : 'jpg'}` };
      }
      if (!current()) return;
      const sizeBytes = await resolveLocalFileSize(prepared.uri);
      if (!current()) return;
      if (sizeBytes > 5 * 1024 * 1024) { Alert.alert(t('chat.stickers.tooLarge')); return; }
      const presign = await requestUploadPresign({ filename: sanitizeUploadFilename(prepared.filename), contentType: prepared.contentType, folder: 'stickers', sizeBytes });
      if (!current()) return;
      await uploadLocalFileToPresignedUrl(presign.uploadUrl, prepared.contentType, prepared.uri, presign.requiredHeaders);
      if (!current()) return;
      await useStickerStore.getState().save({ objectKey: presign.key, width: prepared.width, height: prepared.height });
    } catch (failure) {
      if (current()) Alert.alert(getStickerErrorMessage(failure, t, t('chat.stickers.saveFailed')));
    } finally {
      addingRef.current = false;
      if (mounted.current) setAdding(false);
    }
  };
  const handleRemoveSticker = (id: string) => {
    const epoch = useAuthStore.getState().sessionEpoch;
    Alert.alert(t('chat.stickers.remove'), t('chat.stickers.removeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => {
        if (!mounted.current || useAuthStore.getState().sessionEpoch !== epoch) return;
        void useStickerStore.getState().remove(id).catch((failure: unknown) => {
          if (mounted.current && useAuthStore.getState().sessionEpoch === epoch) Alert.alert(getStickerErrorMessage(failure, t, t('chat.stickers.saveFailed')));
        });
      } },
    ]);
  };
  return (
    <View
      testID="emoji-picker"
      style={[s.container, { backgroundColor: colors.background }]}
      onLayout={({ nativeEvent }) => setPageWidth(nativeEvent.layout.width)}
    >
      <ScrollView
        ref={tabsRef}
        horizontal
        style={s.tabs}
        contentContainerStyle={s.tabContent}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {pages.map((group, index) => (
          <Pressable
            key={group?.labelKey ?? 'custom'}
            accessibilityRole="tab"
            accessibilityLabel={group ? t(`emojis.${group.labelKey}`) : t('chat.stickers.title')}
            accessibilityState={{ selected: index === activePage }}
            style={[s.tab, index === activePage && { backgroundColor: colors.surface }]}
            onPress={() => selectPage(index)}
          >
            {!group || group.labelKey === 'face' ? (
              <Ionicons name={group ? 'happy-outline' : 'heart-outline'} size={28} color={index === activePage ? colors.iconAccent : colors.textSecondary} />
            ) : <Text style={s.tabEmoji}>{group.emojis[0]}</Text>}
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        ref={pagerRef}
        testID="emoji-picker-pages"
        horizontal
        pagingEnabled
        nestedScrollEnabled
        directionalLockEnabled
        style={s.pager}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={({ nativeEvent }) => selectPage(Math.round(nativeEvent.contentOffset.x / nativeEvent.layoutMeasurement.width), false)}
        onContentSizeChange={() => pagerRef.current?.scrollTo({ x: activePage * pageWidth, animated: false })}
      >
        {pages.map((group, index) => (
          <BottomSheetScrollView
            key={group?.labelKey ?? 'custom'}
            testID={`emoji-page-${group?.labelKey ?? 'custom'}`}
            style={{ width: pageWidth }}
            contentContainerStyle={s.content}
            nestedScrollEnabled
            directionalLockEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            accessibilityElementsHidden={index !== activePage}
            importantForAccessibility={index === activePage ? 'auto' : 'no-hide-descendants'}
          >
            <Text style={[s.groupLabel, { color: colors.textSecondary }]}>{group ? t(`emojis.${group.labelKey}`) : t('chat.stickers.title')}</Text>
            {group ? <View style={s.grid}>
              {group.emojis.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={s.cell}
                  onPress={() => onSelect(emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={emoji}
                >
                  <Text style={s.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View> : <>
              {loading ? <ActivityIndicator /> : null}
              {error ? <Pressable accessibilityRole="button" onPress={() => void refresh()}><Text style={{ color: colors.textSecondary }}>{t('chat.stickers.loadFailed')}</Text></Pressable> : null}
              <View style={s.grid}>
                {items.map((sticker) => (
                  <View key={sticker.id} style={s.stickerCell}>
                    <Pressable testID={`custom-sticker-${sticker.id}`} accessibilityRole="button" accessibilityLabel={t('chat.stickers.title')} onPress={() => onSelectSticker?.(sticker)}>
                      <Image testID={`custom-sticker-image-${sticker.id}`} source={{ uri: sticker.url }} style={s.stickerImage} contentFit="contain" enforceEarlyResizing cachePolicy="memory" recyclingKey={sticker.id} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('chat.stickers.remove')} hitSlop={8} style={s.removeSticker} onPress={() => handleRemoveSticker(sticker.id)}>
                      <Text style={{ color: colors.textSecondary }}>×</Text>
                    </Pressable>
                  </View>
                ))}
                <Pressable style={[s.stickerCell, s.addSticker]} accessibilityRole="button" accessibilityLabel={t('chat.stickers.add')} disabled={adding} onPress={() => void handleAddSticker()}>
                  {adding ? <ActivityIndicator /> : <Text style={{ color: colors.textSecondary, fontSize: 32 }}>+</Text>}
                </Pressable>
              </View>
            </>}
          </BottomSheetScrollView>
        ))}
      </ScrollView>
    </View>
  );
});
