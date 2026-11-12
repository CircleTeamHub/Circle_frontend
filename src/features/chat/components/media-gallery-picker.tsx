import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { SEND_CAPTION_MAX_LENGTH } from '@/features/chat/components/send-confirm-dialog';
import {
  formatGalleryDuration,
  GALLERY_PAGE_SIZE,
  type GalleryAccess,
  galleryMediaTypes,
  type MediaGalleryMode,
  readGalleryAccess,
  requestGalleryAccess,
  resolveGalleryAssets,
} from '@/features/chat/utils/media-gallery';
import { MAX_CHAT_IMAGE_SELECTION } from '@/features/chat/utils/media-upload-scheduler';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface MediaGalleryPickerProps {
  /** null 时关闭。 */
  mode: MediaGalleryMode | null;
  onCancel: () => void;
  /** caption 已去掉首尾空白,没填时是空字符串。 */
  onConfirm: (assets: ImagePickerAsset[], caption: string) => void;
  /** 没有相册权限(或平台不支持)时改用系统相册,带上已经填好的描述。 */
  onPickFromSystem: (caption: string) => void;
  /** iOS:完全关闭后调用,下一个全屏弹层要等到这时才能弹出。 */
  onDismiss?: () => void;
}

const COLUMNS = 4;
const GAP = 2;
const G = {
  background: '#0E0E10',
  surface: '#1C1C1F',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.6)',
  border: 'rgba(255,255,255,0.75)',
  shade: 'rgba(0,0,0,0.28)',
} as const;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: G.background },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  headerSide: { width: 104, flexDirection: 'row', alignItems: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  albumPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    maxWidth: 180,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: G.surface,
  },
  albumPillText: { ...Typography.body, color: G.text, flexShrink: 1 },
  singleToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, justifyContent: 'flex-end', flex: 1 },
  singleLabel: { ...Typography.caption, color: G.text },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: G.surface,
  },
  noticeText: { ...Typography.caption, color: G.muted, flex: 1 },
  noticeAction: { ...Typography.caption, fontWeight: '600' },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  centerTitle: { ...Typography.h3, color: G.text, textAlign: 'center' },
  centerText: { ...Typography.body, color: G.muted, textAlign: 'center' },
  pillButton: {
    minWidth: 180,
    height: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillButtonText: { ...Typography.body, color: G.text, fontWeight: '600' },
  row: { gap: GAP },
  cell: { overflow: 'hidden', backgroundColor: G.surface },
  fill: { width: '100%', height: '100%' },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: G.border,
    backgroundColor: G.shade,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { ...Typography.tiny, color: G.text, fontWeight: '700' },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  videoText: { ...Typography.tiny, color: G.text },
  captionInput: {
    ...Typography.body,
    color: G.text,
    minHeight: 44,
    maxHeight: 96,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: G.surface,
  },
  footer: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  footerText: { ...Typography.body, color: G.text },
  confirmButton: {
    minWidth: 76,
    height: 38,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: G.background },
  albumList: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    maxHeight: '75%',
    backgroundColor: G.surface,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
  },
  albumBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  albumRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  albumTitle: { ...Typography.body, color: G.text, flex: 1 },
  albumCount: { ...Typography.caption, color: G.muted },
  previewHeader: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md },
  previewTitle: { ...Typography.body, color: G.text, flex: 1, textAlign: 'center', marginRight: 44 },
  playBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -32,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

interface GalleryCellProps {
  asset: MediaLibrary.Asset;
  size: number;
  order: number | undefined;
  disabled: boolean;
  accent: string;
  label: string;
  onToggle: (asset: MediaLibrary.Asset) => void;
}

const GalleryCell = memo(function GalleryCell({ asset, size, order, disabled, accent, label, onToggle }: GalleryCellProps) {
  const isVideo = asset.mediaType === MediaLibrary.MediaType.video;
  return (
    <Pressable
      style={[s.cell, { width: size, height: size }]}
      onPress={() => onToggle(asset)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: order !== undefined, disabled }}
      accessibilityLabel={label}
    >
      <Image source={{ uri: asset.uri }} style={s.fill} contentFit="cover" recyclingKey={asset.id} transition={0} />
      <View style={[s.check, order !== undefined && { backgroundColor: accent, borderColor: accent }]}>
        {order !== undefined ? <Text style={s.checkText}>{order}</Text> : null}
      </View>
      {isVideo ? (
        <View style={s.videoBadge}>
          <Ionicons name="videocam" size={12} color={G.text} />
          <Text style={s.videoText}>{formatGalleryDuration(asset.duration)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

function GalleryPreview({
  assets,
  initialIndex,
  onClose,
}: {
  assets: MediaLibrary.Asset[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  // 横向分页里的子项拿不到百分比高度,按列表区域实际高度排。
  const [pageHeight, setPageHeight] = useState(0);
  return (
    <View style={[s.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.previewHeader}>
        <Pressable style={s.iconButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Ionicons name="chevron-back" size={26} color={G.text} />
        </Pressable>
        <Text style={s.previewTitle}>{`${index + 1}/${assets.length}`}</Text>
      </View>
      <View style={s.body} onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}>
        {pageHeight > 0 ? (
          <FlatList
            data={assets}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
            keyExtractor={(item) => item.id}
            onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={{ width, height: pageHeight }}>
                <Image source={{ uri: item.uri }} style={s.fill} contentFit="contain" />
                {item.mediaType === MediaLibrary.MediaType.video ? (
                  <View style={s.playBadge}>
                    <Ionicons name="play" size={30} color={G.text} />
                  </View>
                ) : null}
              </View>
            )}
          />
        ) : null}
      </View>
    </View>
  );
}

function AlbumList({
  albums,
  currentId,
  onSelect,
  onClose,
}: {
  albums: MediaLibrary.Album[] | null;
  currentId: string | null;
  onSelect: (album: MediaLibrary.Album | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const rows: { id: string | null; title: string; album: MediaLibrary.Album | null; count?: number }[] = [
    { id: null, title: t('chat.mediaPicker.recents', { defaultValue: '最近项目' }), album: null },
    ...(albums ?? []).map((album) => ({ id: album.id, title: album.title, album, count: album.assetCount })),
  ];
  return (
    <>
      <Pressable style={s.albumBackdrop} onPress={onClose} accessible={false} />
      <View style={s.albumList}>
        {albums === null ? (
          <ActivityIndicator style={{ margin: Spacing.lg }} color={G.text} />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.id ?? 'recents'}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [s.albumRow, pressed && { opacity: 0.6 }]}
                onPress={() => onSelect(item.album)}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === currentId }}
                accessibilityLabel={item.title}
              >
                <Text style={s.albumTitle} numberOfLines={1}>{item.title}</Text>
                {item.count !== undefined ? <Text style={s.albumCount}>{item.count}</Text> : null}
                {item.id === currentId ? (
                  <Ionicons name="checkmark" size={20} color={colors.primary} style={{ marginLeft: Spacing.sm }} />
                ) : null}
              </Pressable>
            )}
          />
        )}
      </View>
    </>
  );
}

/**
 * 聊天的应用内相册:网格浏览最近的照片和视频,按选择顺序编号,可切换相册、单张模式,
 * 选图的同时填描述;确认时把选中项换成本地文件交给发送管线。
 * 拿不到相册权限(或 Web)时提示去设置,并可改用系统相册。
 *
 * 每次打开挂载一个新的 GallerySession(key 递增):选择、描述、相册、权限状态都从头开始,
 * 不会把上一次的状态带进新的一次;关闭动画期间旧会话保持原样渲染。
 */
export function MediaGalleryPicker({ mode, ...handlers }: MediaGalleryPickerProps) {
  const [prevMode, setPrevMode] = useState(mode);
  const [session, setSession] = useState({ id: mode === null ? 0 : 1, mode: mode ?? 'send' });
  if (mode !== prevMode) {
    setPrevMode(mode);
    if (mode !== null) setSession((current) => ({ id: current.id + 1, mode }));
  }
  // 从没打开过就什么都不挂,免得聊天页一进来就去请求相册权限。
  if (session.id === 0) return null;
  return <GallerySession key={session.id} mode={session.mode} visible={mode !== null} {...handlers} />;
}

function GallerySession({
  mode,
  visible,
  onCancel,
  onConfirm,
  onPickFromSystem,
  onDismiss,
}: Omit<MediaGalleryPickerProps, 'mode'> & { mode: MediaGalleryMode; visible: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [access, setAccess] = useState<GalleryAccess>('checking');
  const [album, setAlbum] = useState<MediaLibrary.Album | null>(null);
  const [albums, setAlbums] = useState<MediaLibrary.Album[] | null>(null);
  const [albumListOpen, setAlbumListOpen] = useState(false);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<MediaLibrary.Asset[]>([]);
  const [singleMode, setSingleMode] = useState(false);
  const [caption, setCaption] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedRef = useRef<MediaLibrary.Asset[]>([]);
  const pageRequestRef = useRef(0);
  const loadedPagesRef = useRef(0);
  const visibleRef = useRef(visible);
  const singleSelect = mode === 'edit' || singleMode;
  const browsable = access === 'all' || access === 'limited';
  const cellSize = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const commitSelection = useCallback((next: MediaLibrary.Asset[]) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    requestGalleryAccess().then(
      (next) => {
        if (!cancelled) setAccess(next);
      },
      (error: unknown) => {
        reportHandledFailure('chatMediaPicker', 'requestAccess', error);
        if (!cancelled) setAccess('unavailable');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // 从设置页授权回来时刷新,不必关掉再开。
  useEffect(() => {
    if (!visible || access !== 'denied') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      readGalleryAccess().then(setAccess, (error: unknown) => {
        reportHandledFailure('chatMediaPicker', 'readAccess', error);
      });
    });
    return () => subscription.remove();
  }, [access, visible]);

  const loadPage = useCallback(
    async (after?: string) => {
      const request = ++pageRequestRef.current;
      setLoading(true);
      try {
        const page = await MediaLibrary.getAssetsAsync({
          first: GALLERY_PAGE_SIZE,
          after,
          album: album ?? undefined,
          mediaType: galleryMediaTypes(mode),
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        if (request !== pageRequestRef.current) return;
        setAssets((current) => (after ? [...current, ...page.assets] : page.assets));
        loadedPagesRef.current = after ? loadedPagesRef.current + 1 : 1;
        setCursor(page.hasNextPage ? page.endCursor : undefined);
        setLoadFailed(false);
      } catch (error) {
        reportHandledFailure('chatMediaPicker', 'loadAssets', error);
        if (request === pageRequestRef.current) setLoadFailed(true);
      } finally {
        if (request === pageRequestRef.current) setLoading(false);
      }
    },
    [mode, album],
  );

  useEffect(() => {
    if (!visible || !browsable) return;
    void loadPage();
    // 相册有增删(含 iOS 上调整「部分照片」的范围)时从第一页重新拉;
    // 已经往下翻过页就不动,免得 iCloud 同步把正在看的位置冲回顶部。
    const subscription = MediaLibrary.addListener(() => {
      if (loadedPagesRef.current <= 1) void loadPage();
    });
    return () => subscription.remove();
  }, [browsable, loadPage, visible]);

  const toggleAsset = useCallback(
    (asset: MediaLibrary.Asset) => {
      const current = selectedRef.current;
      if (current.some((item) => item.id === asset.id)) {
        commitSelection(current.filter((item) => item.id !== asset.id));
        return;
      }
      if (singleSelect) {
        commitSelection([asset]);
        return;
      }
      if (current.length >= MAX_CHAT_IMAGE_SELECTION) {
        Alert.alert(
          t('chat.mediaPicker.selectionLimit', {
            count: MAX_CHAT_IMAGE_SELECTION,
            defaultValue: '最多选择 {{count}} 项',
          }),
        );
        return;
      }
      commitSelection([...current, asset]);
    },
    [commitSelection, singleSelect, t],
  );

  const handleSingleModeChange = useCallback(
    (next: boolean) => {
      setSingleMode(next);
      if (next) commitSelection(selectedRef.current.slice(0, 1));
    },
    [commitSelection],
  );

  const openAlbumList = useCallback(() => {
    setAlbumListOpen(true);
    if (albums !== null) return;
    MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true }).then(
      (list) => setAlbums(list.filter((item) => item.assetCount > 0)),
      (error: unknown) => {
        reportHandledFailure('chatMediaPicker', 'loadAlbums', error);
        setAlbums([]);
      },
    );
  }, [albums]);

  const manageLimitedAccess = useCallback(() => {
    // 选择范围变了之后,上面的相册监听会刷新网格。
    MediaLibrary.presentPermissionsPickerAsync().catch((error: unknown) => {
      reportHandledFailure('chatMediaPicker', 'manageAccess', error);
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    const picked = selectedRef.current;
    if (picked.length === 0 || submitting) return;
    setSubmitting(true);
    // 逐项读取,失败的项被跳过,不会整体抛错(见 resolveGalleryAssets)。
    const resolved = await resolveGalleryAssets(picked);
    setSubmitting(false);
    // 等 iCloud 下载的时候用户可能已经关掉了相册,这时不能再替他发出去。
    if (!visibleRef.current) return;
    if (resolved.length === 0) {
      Alert.alert(t('chat.mediaPicker.resolveFailed', { defaultValue: '读取所选内容失败，请重试' }));
      return;
    }
    if (resolved.length < picked.length) {
      Alert.alert(t('chat.mediaPicker.someSkipped', { defaultValue: '部分内容无法读取，已跳过' }));
    }
    onConfirm(resolved, caption.trim());
  }, [caption, onConfirm, submitting, t]);

  const handleRequestClose = useCallback(() => {
    if (previewIndex !== null) setPreviewIndex(null);
    else if (albumListOpen) setAlbumListOpen(false);
    else onCancel();
  }, [albumListOpen, onCancel, previewIndex]);

  const order = useMemo(() => new Map(selected.map((asset, index) => [asset.id, index + 1])), [selected]);
  const photoLabel = t('chat.mediaPicker.photo', { defaultValue: '照片' });
  const videoLabel = t('chat.mediaPicker.video', { defaultValue: '视频' });
  const albumTitle = album?.title ?? t('chat.mediaPicker.recents', { defaultValue: '最近项目' });
  const count = selected.length;

  const body = (() => {
    if (access === 'checking') return <ActivityIndicator style={s.center} color={G.text} />;
    if (!browsable) {
      return (
        <View style={s.center}>
          <Ionicons name="images-outline" size={44} color={G.muted} />
          <Text style={s.centerTitle}>
            {t('chat.mediaPicker.permissionTitle', { defaultValue: '需要相册权限' })}
          </Text>
          <Text style={s.centerText}>
            {t('chat.mediaPicker.permissionMessage', {
              defaultValue: '允许访问照片和视频后，可以在这里直接选择并发送',
            })}
          </Text>
          {access === 'denied' ? (
            <Pressable
              style={[s.pillButton, { backgroundColor: colors.primary }]}
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
            >
              <Text style={s.pillButtonText}>
                {t('chat.mediaPicker.openSettings', { defaultValue: '去设置' })}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[s.pillButton, { backgroundColor: G.surface }]}
            onPress={() => onPickFromSystem(caption.trim())}
            accessibilityRole="button"
          >
            <Text style={s.pillButtonText}>
              {t('chat.mediaPicker.useSystemPicker', { defaultValue: '从系统相册选择' })}
            </Text>
          </Pressable>
        </View>
      );
    }
    if (assets.length === 0 && (loading || loadFailed)) {
      return loadFailed ? (
        <Pressable style={s.center} onPress={() => void loadPage()} accessibilityRole="button">
          <Text style={s.centerText}>
            {t('chat.mediaPicker.loadFailed', { defaultValue: '相册读取失败，轻触重试' })}
          </Text>
        </Pressable>
      ) : (
        <ActivityIndicator style={s.center} color={G.text} />
      );
    }
    return (
      <FlatList
        data={assets}
        numColumns={COLUMNS}
        columnWrapperStyle={s.row}
        contentContainerStyle={{ gap: GAP }}
        keyExtractor={(item) => item.id}
        extraData={order}
        initialNumToRender={COLUMNS * 8}
        onEndReachedThreshold={1.5}
        onEndReached={() => {
          if (!loading && cursor) void loadPage(cursor);
        }}
        ListEmptyComponent={
          <Text style={[s.centerText, { marginTop: Spacing.xl }]}>
            {t('chat.mediaPicker.empty', { defaultValue: '没有照片或视频' })}
          </Text>
        }
        renderItem={({ item }) => (
          <GalleryCell
            asset={item}
            size={cellSize}
            order={order.get(item.id)}
            disabled={submitting}
            accent={colors.primary}
            label={item.mediaType === MediaLibrary.MediaType.video ? videoLabel : photoLabel}
            onToggle={toggleAsset}
          />
        )}
      />
    );
  })();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleRequestClose}
      onDismiss={onDismiss}
    >
      <StatusBar style="light" />
      <KeyboardAvoidingContainer style={s.root}>
        <View style={[s.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
          <View style={s.header}>
            <View style={s.headerSide}>
              <Pressable
                style={s.iconButton}
                onPress={onCancel}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close" size={28} color={G.text} />
              </Pressable>
            </View>
            {browsable ? (
              <Pressable
                style={s.albumPill}
                onPress={albumListOpen ? () => setAlbumListOpen(false) : openAlbumList}
                accessibilityRole="button"
                accessibilityLabel={t('chat.mediaPicker.switchAlbum', { defaultValue: '切换相册' })}
              >
                <Text style={s.albumPillText} numberOfLines={1}>{albumTitle}</Text>
                <Ionicons name={albumListOpen ? 'chevron-up-circle' : 'chevron-down-circle'} size={20} color={G.text} />
              </Pressable>
            ) : null}
            <View style={s.headerSide}>
              {mode === 'send' ? (
                <View style={s.singleToggle}>
                  <Text style={s.singleLabel}>{t('chat.mediaPicker.single', { defaultValue: '单张' })}</Text>
                  <ThemedSwitch
                    value={singleMode}
                    onValueChange={handleSingleModeChange}
                    accessibilityLabel={t('chat.mediaPicker.single', { defaultValue: '单张' })}
                  />
                </View>
              ) : null}
            </View>
          </View>

          {access === 'limited' ? (
            <View style={s.notice}>
              <Text style={s.noticeText}>
                {t('chat.mediaPicker.limitedNotice', { defaultValue: '你只允许访问部分照片和视频' })}
              </Text>
              <Pressable onPress={manageLimitedAccess} accessibilityRole="button" hitSlop={8}>
                <Text style={[s.noticeAction, { color: colors.primary }]}>
                  {t('chat.mediaPicker.manageAccess', { defaultValue: '管理' })}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={s.body}>
            {body}
            {albumListOpen ? (
              <AlbumList
                albums={albums}
                currentId={album?.id ?? null}
                onClose={() => setAlbumListOpen(false)}
                onSelect={(next) => {
                  setAlbumListOpen(false);
                  setAlbum(next);
                }}
              />
            ) : null}
          </View>

          <TextInput
            style={s.captionInput}
            value={caption}
            onChangeText={setCaption}
            placeholder={t('chat.mediaPicker.captionPlaceholder', { defaultValue: '请输入描述' })}
            placeholderTextColor={G.muted}
            maxLength={SEND_CAPTION_MAX_LENGTH}
            multiline
            editable={!submitting}
          />
          <View style={s.footer}>
            <Pressable
              onPress={() => setPreviewIndex(0)}
              disabled={count === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: count === 0 }}
              hitSlop={8}
            >
              <Text style={[s.footerText, count === 0 && { opacity: 0.4 }]}>
                {t('chat.mediaPicker.preview', { defaultValue: '预览' })}
              </Text>
            </Pressable>
            <Pressable
              style={[s.confirmButton, { backgroundColor: colors.primary }, (count === 0 || submitting) && { opacity: 0.45 }]}
              onPress={() => void handleConfirm()}
              disabled={count === 0 || submitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: count === 0 || submitting }}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={G.text} />
              ) : (
                <Text style={s.pillButtonText}>
                  {count > 0
                    ? t('chat.mediaPicker.confirmCount', { count, defaultValue: '确认({{count}})' })
                    : t('chat.mediaPicker.confirm', { defaultValue: '确认' })}
                </Text>
              )}
            </Pressable>
          </View>

          {previewIndex !== null && count > 0 ? (
            <GalleryPreview
              assets={selected}
              initialIndex={Math.min(previewIndex, count - 1)}
              onClose={() => setPreviewIndex(null)}
            />
          ) : null}
        </View>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}
