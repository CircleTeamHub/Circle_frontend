import { getGroupEntryHref } from '@/features/groups/routes';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useSegments,
} from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteDocumentBody } from '@/features/notes/components/NoteDocumentBody';
import { ImageViewer } from '@/components/ui/image-viewer';
import { ShareNoteSheet } from '@/features/notes/components/ShareNoteSheet';
import { buildNoteCardPayloadFromSummary } from '@/features/chat/utils/note-card-payload';
import type { NoteDetail, NoteExportFormat } from '@/features/notes/types';
import {
  getUserProfileHref,
  getCircleDetailHref,
  getUserProfileScopeFromSegments,
  toCircleScope,
} from '@/features/user/utils/routes';
import { logClientDiagnostic } from '@/utils/client-diagnostics';
import {
  buildNoteSections,
  getNoteVideoItems,
  getNoteViewerImages,
  getInitialNoteSection,
  getNoteSectionAvailability,
  type NoteSectionKind,
} from '@/features/notes/utils/note-sections';
import {
  normalizeNoteComposerOrder,
  readNoteComposerOrder,
} from '@/features/notes/utils/note-composer';
import { shouldUseDirectVideoExportFallback } from '@/features/notes/utils/note-export';
import { createNoteExport, fetchNoteDetail, notesMutatedSince } from '@/services/api/notes';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { getApiErrorMessage } from '@/services/api/errors';
import { ApiError } from '@/services/api/client';
import { downloadMediaToCache, saveMediaToLibrary } from '@/utils/save-image';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import { withNoteSyncRetry } from '@/features/notes/utils/note-sync';

function stripNoteCardBlocks(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripNoteCardBlocks(item))
      .filter((item) => item !== null);
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'contact' || record.type === 'group') return null;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, stripNoteCardBlocks(item)]),
  );
}

export default function NoteDetailScreen() {
  const router = useRouter();
  // 本页在哪个 tab 栈打开（profile/messages/...），决定聊天页往哪个栈推。
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { id, ownerId, section } = useLocalSearchParams<{
    id: string;
    ownerId?: string;
    section?: string;
  }>();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const noteStatusVersion = useNoteStatusSignalStore((state) => state.version);

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<NoteExportFormat | null>(null);
  const [downloadMenuVisible, setDownloadMenuVisible] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerIndex, setImageViewerIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const sectionYRef = useRef<Partial<Record<NoteSectionKind, number>>>({});
  const scrolledSectionRef = useRef<string | null>(null);
  const noteLoadedRef = useRef(false);
  // 从编辑页/群名片回来:编辑会走笔记写请求(notesMutatedSince)必重拉;只是看了看就回来、
  // 30 秒内、来源状态没变,就不再重拉。窗口远小于媒体签名的有效期。
  const reloadGate = useFocusReloadGate({
    key: `${id ?? ''}:${noteStatusVersion}`,
    mutatedSince: notesMutatedSince,
  });

  const loadNote = useCallback(() => {
    // Re-run the focus loader when a realtime source-status signal advances.
    void noteStatusVersion;
    if (!id) {
      setLoading(false);
      return () => undefined;
    }
    let cancelled = false;
    const startedAt = Date.now();
    // 已经有内容时后台刷新,不整屏转圈(回到页面时那一下闪烁)。
    if (!noteLoadedRef.current) setLoading(true);
    setLoadError(null);
    withNoteSyncRetry(() => fetchNoteDetail(id))
      .then((data) => {
        if (cancelled) return;
        setNote(data);
        setLoading(false);
        noteLoadedRef.current = true;
        reloadGate.markLoaded(startedAt);
      })
      .catch((error) => {
        if (cancelled) return;
        // 404 真的不存在；其它失败都是网络/服务异常，应当让用户重试。
        if (error instanceof ApiError && error.status === 404) {
          setNote(null);
          setLoadError(null);
        } else {
          setLoadError(
            t('notes.detail.loadFailed', {
              defaultValue: '笔记加载失败，请稍后重试',
            }),
          );
          reportHandledFailure('notes', 'fetchDetail', error);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, noteStatusVersion, reloadGate, t]);

  // useFocusEffect 而不是 useEffect：笔记媒体现在走 presign-on-read，URL 是有 TTL 的短时
  // 签名。只在 mount 拉一次的话，从编辑页/别的 tab 回来时手里还是旧签名，过期就整屏空图。
  // 每次获得焦点重拉既拿到新签名，也顺带刷新编辑后的内容（与 NotesScreen 一致）。
  useFocusEffect(
    useCallback(
      () => (reloadGate.shouldSkip() ? undefined : loadNote()),
      [loadNote, reloadGate],
    ),
  );

  // 图片 403 自愈：presign 签名过期时重拉一次拿新签名（App 挂后台数小时再回来滚动，
  // 焦点没变、useFocusEffect 不触发，只能靠这里）。30s 节流 —— 图片本身坏掉时重拉救不了，
  // 不能让 onError → refetch → onError 打转。
  const lastMediaRetryRef = useRef(0);
  // 群名片：独立群（服务端标注了会话 id）直接进群聊；圈子群名片维持进圈子详情。
  const handleGroupCardPress = useCallback(
    (id: string, name?: string, conversationID?: string) => {
      if (conversationID) {
        router.push(
          getGroupEntryHref(scope, { groupId: conversationID }),
        );
        return;
      }
      router.push(getCircleDetailHref(toCircleScope(scope), id));
    },
    [router, scope],
  );

  const handleMediaError = useCallback(() => {
    const now = Date.now();
    if (now - lastMediaRetryRef.current < 30_000) return;
    lastMediaRetryRef.current = now;
    logClientDiagnostic('note_media_load_failed', { noteId: id });
    loadNote();
  }, [id, loadNote]);

  const handleEdit = useCallback(() => {
    if (!note) return;
    router.push(`/(tabs)/profile/notes/edit?id=${note.id}` as never);
  }, [router, note]);

  const sections = useMemo(() => (note ? buildNoteSections(note) : null), [note]);
  const readOnlySections = useMemo(() => {
    if (!sections) return null;
    return {
      ...sections,
      text: {
        ...sections.text,
        contentJson: stripNoteCardBlocks(sections.text.contentJson) as typeof sections.text.contentJson,
      },
      contacts: { items: [] },
      groups: { items: [] },
    };
  }, [sections]);
  const readOnlyLayout = useMemo(
    () => stripNoteCardBlocks(note?.sections?.text?.contentJson ?? note?.contentJson ?? []),
    [note?.contentJson, note?.sections?.text?.contentJson],
  );
  const availability = useMemo(
    () => (sections ? getNoteSectionAvailability(sections) : null),
    [sections],
  );
  const detailOrder = useMemo<NoteSectionKind[]>(() => {
    if (!sections || !availability) return [];
    const saved = readNoteComposerOrder(
      note?.sections?.text?.contentJson ?? note?.contentJson ?? [],
    );
    const normalized = normalizeNoteComposerOrder(
      saved,
      sections as unknown as Parameters<typeof normalizeNoteComposerOrder>[1],
      false,
    );
    const mapped = normalized.flatMap((kind): NoteSectionKind[] => {
      if (kind === 'text') return ['text'];
      if (kind === 'image') return ['media'];
      if (kind === 'video') return ['media'];
      if (kind === 'showcase') return ['showcase'];
      if (kind === 'audio') return ['audio'];
      if (kind === 'contact') return ['contact'];
      if (kind === 'group') return ['group'];
      if (kind === 'location') return ['location'];
      return [];
    });
    const available = new Set<NoteSectionKind>(['text']);
    if (availability.hasMedia) available.add('media');
    if (availability.hasShowcase) available.add('showcase');
    if (availability.hasAudio) available.add('audio');
    if (availability.hasContacts) available.add('contact');
    if (availability.hasGroups) available.add('group');
    if (availability.hasLocation) available.add('location');
    // 个人名片和群名片只在笔记编辑/config 区使用；聊天或只读详情永远不展示。
    return [...new Set([...mapped, ...available])].filter(
      (kind) => available.has(kind) && kind !== 'contact' && kind !== 'group',
    );
  }, [availability, note?.contentJson, note?.sections?.text?.contentJson, sections]);
  // 拿不到地址的条目渲染出来是空的（服务端读接口没能为这个 objectKey 现签地址），
  // 不进列表；整块是否显示由 getNoteSectionAvailability 按同一判据决定。
  const viewerImages = useMemo(() => sections ? getNoteViewerImages(sections) : [], [sections]);
  const videoItems = useMemo(() => (sections ? getNoteVideoItems(sections) : []), [sections]);
  useEffect(() => {
    if (viewerImages.length === 0) {
      setImageViewerVisible(false);
      setImageViewerIndex(0);
      return;
    }
    setImageViewerIndex((current) => Math.min(current, viewerImages.length - 1));
  }, [viewerImages.length]);
  const handleImagePress = useCallback(
    (uri: string, objectKey?: string) => {
      const index = viewerImages.findIndex((item) =>
        objectKey
          ? item.objectKey === objectKey || (!item.objectKey && item.url === uri)
          : item.url === uri,
      );
      if (index < 0) return;
      setImageViewerIndex(index);
      setImageViewerVisible(true);
    },
    [viewerImages],
  );
  const targetSection = useMemo(
    () => (sections ? getInitialNoteSection(section, sections) : null),
    [section, sections],
  );

  const saveVideosDirectly = useCallback(async () => {
    if (videoItems.length === 0) {
      Alert.alert(
        t('notes.detail.exportFailedTitle', { defaultValue: '导出失败' }),
        t('serverErrors.NOTE_EXPORT_NO_MEDIA', {
          defaultValue: '没有可导出的媒体文件',
        }),
      );
      return false;
    }

    for (const item of videoItems) {
      const outcome = await saveMediaToLibrary(item.url, {
        mimeType: item.mimeType ?? undefined,
      });
      if (outcome === 'denied') {
        Alert.alert(t('media.saveDeniedTitle'), t('media.saveDeniedMessage'));
        return false;
      }
      if (outcome === 'failed') {
        Alert.alert(
          t('notes.detail.exportFailedTitle', { defaultValue: '导出失败' }),
          t('notes.detail.exportFailedMessage', {
            defaultValue: '视频下载失败，请稍后重试',
          }),
        );
        return false;
      }
    }
    setDownloadMenuVisible(false);
    return true;
  }, [t, videoItems]);

  const saveLongImageExport = useCallback(
    async (result: { url: string; filename: string; mimeType: string }) => {
      // 长图是一个媒体文件：交给相册/浏览器下载，不能把预签名地址塞进
      // Share.message，否则系统会把整次操作识别成“分享文本”。
      const outcome = await saveMediaToLibrary(result.url, {
        mimeType: result.mimeType,
      });
      if (outcome === 'saved') return true;
      if (outcome === 'denied') {
        Alert.alert(t('media.saveDeniedTitle'), t('media.saveDeniedMessage'));
        return false;
      }

      // 某些原生系统不接受 SVG 写入相册，仍给用户一个文件分享兜底；
      // 这里刻意只传 url，不传 message，避免退化成一段文本。
      const cached = await downloadMediaToCache(result.url, {
        mimeType: result.mimeType,
      });
      if (cached) {
        try {
          await Share.share({ url: cached.uri, title: result.filename });
        } finally {
          await cached.cleanup();
        }
      } else {
        await Share.share({ url: result.url, title: result.filename });
      }
      return true;
    },
    [t],
  );

  const scrollToRequestedSection = useCallback(() => {
    if (!note || !targetSection) return;
    const scrollKey = `${note.id}:${targetSection}`;
    if (scrolledSectionRef.current === scrollKey) return;
    const y = sectionYRef.current[targetSection];
    if (typeof y !== 'number') return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    scrolledSectionRef.current = scrollKey;
  }, [note, targetSection]);

  useEffect(() => {
    scrolledSectionRef.current = null;
    const timer = setTimeout(scrollToRequestedSection, 100);
    return () => clearTimeout(timer);
  }, [scrollToRequestedSection]);

  const trackSectionLayout = useCallback(
    (kind: NoteSectionKind) => (event: LayoutChangeEvent) => {
      sectionYRef.current[kind] = event.nativeEvent.layout.y;
      scrollToRequestedSection();
    },
    [scrollToRequestedSection],
  );

  const handleExport = useCallback(
    async (format: NoteExportFormat) => {
      if (!note || exporting) return;
      setExporting(format);
      try {
        try {
          const result = await createNoteExport(note.id, {
            format,
            scope: 'ALL',
          });
          if (format === 'IMAGE') {
            await saveLongImageExport(result);
          } else {
            await Share.share({
              url: result.url,
              message: result.url,
              title: result.filename,
            });
          }
          setDownloadMenuVisible(false);
        } catch (error) {
          // 大视频无法被服务端打成导出包时，改为使用详情接口已经签发的
          // 原始视频地址逐个保存，避免再次经过导出包的单文件/总量上限。
          if (format !== 'VIDEOS' || !shouldUseDirectVideoExportFallback(error)) {
            throw error;
          }
          await saveVideosDirectly();
        }
      } catch (error) {
        Alert.alert(
          t('notes.detail.exportFailedTitle', { defaultValue: '导出失败' }),
          getApiErrorMessage(
            error,
            t('notes.detail.exportFailedMessage', {
              defaultValue: '请稍后重试',
            }),
          ),
        );
      } finally {
        setExporting(null);
      }
    },
    [exporting, note, saveLongImageExport, saveVideosDirectly, t],
  );

  // 分享单条笔记：打开会话选择器，把笔记以卡片消息发给好友/群聊。
  const [shareOpen, setShareOpen] = useState(false);
  const handleShareNote = useCallback(() => setShareOpen(true), []);
  const sharePayloads = useMemo(
    () =>
      shareOpen && note
        ? [buildNoteCardPayloadFromSummary(note, note.ownerId ?? ownerId)]
        : null,
    [note, ownerId, shareOpen],
  );

  const canEditNote = useMemo(() => {
    if (!note) return false;
    if (typeof note.canEdit === 'boolean') return note.canEdit;
    const resolvedOwnerId = note.ownerId ?? ownerId;
    return Boolean(resolvedOwnerId && currentUserId === resolvedOwnerId);
  }, [currentUserId, note, ownerId]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      meta: { color: colors.text },
      iconBtn: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      // 来源名片：主色浅底的"提示条"，CTA 用深一档的实心靛蓝更压得住
      // 悬浮钮用不透明的 surface 底，压在正文/图片上也不透字。
      floatingBtn: {
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.surfaceBorder,
      },
      downloadSheet: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
    }),
    [colors],
  );

  if (loading) {
    return (
      <View style={[s.container, d.container, s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!note) {
    return (
      <View style={[s.container, d.container, s.center, { paddingTop: insets.top }]}>
        <Text style={d.meta}>
          {loadError ??
            t('notes.detail.notFound', { defaultValue: '笔记不存在' })}
        </Text>
        {loadError ? (
          <Pressable
            onPress={loadNote}
            style={{
              marginTop: Spacing.md,
              paddingHorizontal: Spacing.md,
              paddingVertical: Spacing.sm,
              borderRadius: Radius.full,
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: colors.white, ...Typography.caption }}>
              {t('common.retry', { defaultValue: '重试' })}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      {/* Header：右侧动作是圆形描边按钮（设计稿） */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={s.headerActions}>
          <Pressable
            style={[s.headerIconBtn, d.iconBtn]}
            onPress={handleShareNote}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('notes.actions.share', { defaultValue: '分享' })}
          >
            <Ionicons name="share-outline" size={18} color={colors.text} />
          </Pressable>
          {canEditNote ? (
            <Pressable style={[s.headerIconBtn, d.iconBtn]} onPress={handleEdit} hitSlop={4}>
              <Ionicons name="pencil-outline" size={17} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS === 'android'}
        onContentSizeChange={scrollToRequestedSection}
      >
        {readOnlySections ? (
          <NoteDocumentBody
            title={note.title}
            createdAt={note.createdAt}
            groups={note.groups}
            sections={readOnlySections}
            order={detailOrder}
            layout={readOnlyLayout}
            onContactPress={(id, name) => router.navigate(getUserProfileHref(scope, id, name))}
            onGroupPress={handleGroupCardPress}
            onMediaError={handleMediaError}
            onImagePress={handleImagePress}
            onSectionLayout={trackSectionLayout}
          />
        ) : null}
      </ScrollView>

      {/* 只读详情保留下载动作；来源个人名片和群名片仅在编辑/config 区可见。 */}
      {note ? (
        <View style={[s.floatingDock, { bottom: insets.bottom + Spacing.xl }]}>
          {/* 下载入口从顶栏移到这里：菜单内四种导出（图片/视频/长图/PDF）原样复用。 */}
          <Pressable
            style={[s.floatingBtn, d.floatingBtn, exporting !== null && s.floatingBtnBusy]}
            onPress={() => setDownloadMenuVisible(true)}
            disabled={exporting !== null}
            accessibilityRole="button"
            accessibilityLabel={t('notes.actions.download', {
              defaultValue: '下载',
            })}
          >
            {exporting !== null ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="download-outline" size={20} color={colors.text} />
            )}
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={downloadMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDownloadMenuVisible(false)}
      >
        <Pressable style={s.modalBackdrop} onPress={() => setDownloadMenuVisible(false)}>
          <View style={[s.downloadSheet, d.downloadSheet]}>
            {[
              [
                'IMAGES',
                t('notes.detail.downloadImages', { defaultValue: '下载图片' }),
                'image-outline',
              ],
              [
                'VIDEOS',
                t('notes.detail.downloadVideos', { defaultValue: '下载视频' }),
                'videocam-outline',
              ],
              [
                'IMAGE',
                t('notes.detail.downloadLongImage', { defaultValue: '生成长图' }),
                'camera-outline',
              ],
              [
                'PDF',
                t('notes.detail.downloadPdf', { defaultValue: '下载PDF' }),
                'document-text-outline',
              ],
            ].map(([format, label, icon]) => (
              <Pressable
                key={format}
                style={s.downloadAction}
                onPress={() => void handleExport(format as NoteExportFormat)}
                disabled={exporting !== null}
              >
                <Ionicons
                  name={icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={colors.text}
                />
                <Text style={[s.downloadLabel, { color: colors.text }]}>
                  {exporting === format
                    ? t('common.processing', { defaultValue: '处理中...' })
                    : label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <ShareNoteSheet
        payloads={sharePayloads}
        onClose={() => setShareOpen(false)}
      />
      <ImageViewer
        images={viewerImages.map((item) => item.url)}
        cacheKeys={viewerImages.map((item) => item.objectKey)}
        visible={imageViewerVisible}
        initialIndex={imageViewerIndex}
        onClose={() => setImageViewerVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    height: 52,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 4,
    justifyContent: 'flex-end',
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  meta: { ...Typography.caption, fontWeight: '400' },
  // 右下角悬浮列：竖排圆钮，绝对定位不占正文流。
  floatingDock: {
    position: 'absolute',
    right: Spacing.lg,
    gap: Spacing.sm + 4,
    alignItems: 'center',
  },
  floatingBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    // 悬浮在正文之上，投影把它和滚动内容分开。
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  floatingBtnBusy: { opacity: 0.6 },
  floatingAvatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
    padding: Spacing.lg,
  },
  downloadSheet: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm,
  },
  downloadAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  downloadLabel: { ...Typography.body, fontWeight: '600' },
});
