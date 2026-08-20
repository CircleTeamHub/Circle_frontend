import { resolveMessageScanResult } from '@/features/messages/utils/scan-result';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import {
  CameraView,
  scanFromURLAsync,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.48)',
  },
  title: {
    ...Typography.h3,
    color: '#FFFFFF',
  },
  frameWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  frame: {
    width: '78%',
    maxWidth: 300,
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: Radius.lg,
  },
  hint: {
    marginTop: Spacing.lg,
    ...Typography.bodyRegular,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  statusPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  statusIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: {
    ...Typography.h2,
    textAlign: 'center',
  },
  statusText: {
    ...Typography.bodyRegular,
    textAlign: 'center',
    lineHeight: 21,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  button: {
    minHeight: 44,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    ...Typography.body,
    fontWeight: '600',
  },
});

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [isHandlingResult, setIsHandlingResult] = useState(false);
  const [pickingFromAlbum, setPickingFromAlbum] = useState(false);

  const d = useMemo(
    () => ({
      statusPane: {
        backgroundColor: colors.background,
      },
      statusIcon: {
        backgroundColor: colors.primaryLight,
      },
      statusTitle: {
        color: colors.text,
      },
      statusText: {
        color: colors.textSecondary,
      },
      primaryButton: {
        backgroundColor: colors.primary,
      },
      secondaryButton: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        borderWidth: 1,
      },
      primaryButtonText: {
        color: colors.white,
      },
      secondaryButtonText: {
        color: colors.text,
      },
    }),
    [colors],
  );

  const handleCopyFallback = useCallback(
    async (value: string) => {
      try {
        await Clipboard.setStringAsync(value);
        Alert.alert(
          t('messages.scanCopiedTitle'),
          t('messages.scanCopiedMessage'),
          [
            {
              text: t('messages.scanAgain'),
              onPress: () => setIsHandlingResult(false),
            },
            {
              text: t('common.done'),
              onPress: () => router.back(),
            },
          ],
        );
      } catch (error) {
        if (__DEV__) {
          console.warn('[ScanScreen] copy scanned QR result failed', error);
        }
        Alert.alert(t('messages.scanCopyFailedTitle'), t('messages.scanCopyFailedMessage'), [
          {
            text: t('common.ok'),
            onPress: () => setIsHandlingResult(false),
          },
        ]);
      }
    },
    [router, t],
  );

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (isHandlingResult) return;

      setIsHandlingResult(true);
      const action = resolveMessageScanResult(result.data);

      if (action.type === 'route') {
        router.replace(action.href);
        return;
      }

      void handleCopyFallback(action.value);
    },
    [handleCopyFallback, isHandlingResult, router],
  );

  /**
   * 从相册选一张图识别二维码 —— 「分享二维码到聊天」发的是图片消息,收方不可能
   * 用另一台手机去扫屏幕,只能存图后从相册认。没有这个入口,分享出去的码就是死的。
   */
  const handleScanFromAlbum = useCallback(async () => {
    if (isHandlingResult || pickingFromAlbum) return;
    setPickingFromAlbum(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissions.insufficientTitle'), t('permissions.photoLibrary'));
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (picked.canceled || picked.assets.length === 0) return;

      const [found] = await scanFromURLAsync(picked.assets[0].uri, ['qr']);
      if (!found) {
        Alert.alert(
          t('messages.scanAlbumNoCodeTitle'),
          t('messages.scanAlbumNoCodeMessage'),
        );
        return;
      }
      handleBarcodeScanned(found);
    } catch (error) {
      if (__DEV__) {
        console.warn('[ScanScreen] scan from album failed', error);
      }
      Alert.alert(
        t('messages.scanAlbumFailedTitle'),
        t('messages.scanAlbumFailedMessage'),
      );
    } finally {
      setPickingFromAlbum(false);
    }
  }, [handleBarcodeScanned, isHandlingResult, pickingFromAlbum, t]);

  if (!permission?.granted) {
    const canAskAgain = permission?.canAskAgain !== false;

    return (
      <View style={[s.statusPane, d.statusPane, { paddingTop: insets.top }]}>
        <View style={[s.statusIcon, d.statusIcon]}>
          <Ionicons name="camera-outline" size={26} color={colors.primary} />
        </View>
        <Text style={[s.statusTitle, d.statusTitle]}>
          {t('messages.scanPermissionTitle')}
        </Text>
        <Text style={[s.statusText, d.statusText]} selectable>
          {canAskAgain
            ? t('messages.scanPermissionMessage')
            : t('messages.scanPermissionSettingsMessage')}
        </Text>
        <View style={s.buttonRow}>
          <Pressable
            style={[s.button, d.secondaryButton]}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <Text style={[s.buttonText, d.secondaryButtonText]}>
              {t('common.cancel')}
            </Text>
          </Pressable>
          <Pressable
            style={[s.button, d.secondaryButton]}
            onPress={() => void handleScanFromAlbum()}
            disabled={pickingFromAlbum || isHandlingResult}
            accessibilityRole="button"
          >
            <Text style={[s.buttonText, d.secondaryButtonText]}>
              {t('messages.scanFromAlbum')}
            </Text>
          </Pressable>
          <Pressable
            style={[s.button, d.primaryButton]}
            onPress={canAskAgain ? requestPermission : Linking.openSettings}
            accessibilityRole="button"
          >
            <Text style={[s.buttonText, d.primaryButtonText]}>
              {canAskAgain ? t('messages.scanGrantPermission') : t('messages.scanOpenSettings')}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <CameraView
        style={s.camera}
        facing="back"
        onBarcodeScanned={isHandlingResult ? undefined : handleBarcodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
      <View pointerEvents="box-none" style={[s.topBar, { top: insets.top + Spacing.sm }]}>
        <Pressable
          style={s.iconButton}
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', { defaultValue: '返回' })}
        >
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={s.title}>{t('messages.scan')}</Text>
        <Pressable
          style={s.iconButton}
          onPress={() => void handleScanFromAlbum()}
          disabled={pickingFromAlbum || isHandlingResult}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('messages.scanFromAlbum')}
        >
          {pickingFromAlbum ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons name="images-outline" size={22} color="#FFFFFF" />
          )}
        </Pressable>
      </View>
      <View pointerEvents="none" style={s.frameWrap}>
        <View style={s.frame} />
        <Text style={s.hint}>{t('messages.scanQrHint')}</Text>
      </View>
    </View>
  );
}
