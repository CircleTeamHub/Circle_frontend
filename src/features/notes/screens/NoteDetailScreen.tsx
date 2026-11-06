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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteDocumentBody } from '@/features/notes/components/NoteDocumentBody';
import { NoteImageViewportContext } from '@/features/notes/components/NoteBlockRenderer';
import { ImageViewer } from '@/components/ui/image-viewer';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import {
  NOTE_SHARE_CARD_ONLY,
  ShareNoteSheet,
  type NoteShareRequest,
} from '@/features/notes/components/ShareNoteSheet';
import type { NoteDetail, NoteExportFormat, NoteSummary } from '@/features/notes/types';
import {
  getChatDetailHref,
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
import { collectNote, createNoteExport, fetchNoteDetail, findCollectedNote, getCachedCollectedNote, getCachedNoteDetail, notesMutatedSince } from '@/services/api/notes';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { getApiErrorMessage } from '@/services/api/errors';
import { ApiError } from '@/services/api/client';
import { downloadMediaToCache, saveMediaToLibrary } from '@/utils/save-image';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';
import { diagnosticNow } from '@/observability/http-diagnostics';
import { recordMetric } from '@/observability/metrics';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import { withNoteSyncRetry } from '@/features/notes/utils/note-sync';
import { createNoteImageViewport } from '@/features/notes/utils/note-image-viewport';
import { resolveNoteCollectSource } from '@/features/notes/utils/collect-note-source';
import { buildNoteSectionsWithCards, resolveNoteCardButtons } from '@/features/notes/utils/note-card-peers';

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
  const sessionKey = useAuthStore((state) => state.user?.id ? `${state.user.id}:${state.sessionEpoch}` : null);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return sessionKey ? <NoteDetailContent key={`${sessionKey}:${id ?? ''}`} /> : null;
}

function NoteDetailContent() {
  const router = useRouter();
  // 本页在哪个 tab 栈打开（profile/messages/...），决定聊天页往哪个栈推。
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    id?: string | string[];
    ownerId?: string | string[];
    section?: string | string[];
    sourceConversationId?: string | string[];
    sourceMessageId?: string | string[];
    sourceMessageHeight?: string | string[];
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const ownerId = Array.isArray(params.ownerId) ? params.ownerId[0] : params.ownerId;
  const section = Array.isArray(params.section) ? params.section[0] : params.section;
  const sourceConversationId = Array.isArray(params.sourceConversationId) ? params.sourceConversationId[0] : params.sourceConversationId;
  const sourceMessageId = Array.isArray(params.sourceMessageId) ? params.sourceMessageId[0] : params.sourceMessageId;
  const sourceMessageHeight = Array.isArray(params.sourceMessageHeight) ? params.sourceMessageHeight[0] : params.sourceMessageHeight;
  const currentUserId = useAuthStore((state) => state.user?.id);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const noteStatusVersion = useNoteStatusSignalStore((state) => state.version);

  const [cached] = useState(() => getCachedNoteDetail(id));
  const [cachedCollected] = useState(() => getCachedCollectedNote(id));
  const [note, setNote] = useState<NoteDetail | null>(cached?.value ?? null);
  const [loading, setLoading] = useState(!cached);
  const [detailVerified, setDetailVerified] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<NoteExportFormat | null>(null);
  const [downloadMenuVisible, setDownloadMenuVisible] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerIndex, setImageViewerIndex] = useState(0);
  const collectionKey = `${sessionEpoch}:${id}`;
  const [collectionState, setCollectionState] = useState<{
    key: string;
    status: 'adding' | 'added';
    note?: NoteSummary;
  } | null>(() => cachedCollected?.value ? { key: collectionKey, status: 'added', note: cachedCollected.value } : null);
  const currentCollectionKeyRef = useRef(collectionKey);
  currentCollectionKeyRef.current = collectionKey;
  const collectionRequestRef = useRef<string | null>(null);
  const collectionLookupRef = useRef(0);
  const noteLoadSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const addingNote = collectionState?.key === collectionKey && collectionState.status === 'adding';
  const addedNote = collectionState?.key === collectionKey && collectionState.status === 'added';
  const scrollRef = useRef<ScrollView>(null);
  const imageViewport = useMemo(createNoteImageViewport, []);
  const sectionYRef = useRef<Partial<Record<NoteSectionKind, number>>>({});
  const scrolledSectionRef = useRef<string | null>(null);
  const noteLoadedRef = useRef(cached !== null);
  // 从编辑页/群名片回来:编辑会走笔记写请求(notesMutatedSince)必重拉;只是看了看就回来、
  // 30 秒内、来源状态没变,就不再重拉。窗口远小于媒体签名的有效期。
  const reloadGate = useFocusReloadGate({
    key: `${sessionEpoch}:${id ?? ''}:${noteStatusVersion}`,
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
    const sequence = ++noteLoadSequenceRef.current;
    const isCurrent = () => !cancelled && mountedRef.current &&
      sequence === noteLoadSequenceRef.current && useAuthStore.getState().sessionEpoch === sessionEpoch;
    const startedAt = Date.now();
    // 已经有内容时后台刷新,不整屏转圈(回到页面时那一下闪烁)。
    if (!noteLoadedRef.current) setLoading(true);
    setLoadError(null);
    withNoteSyncRetry(() => fetchNoteDetail(id))
      .then((data) => {
        if (!isCurrent()) return;
        setNote(data);
        setDetailVerified(true);
        setLoading(false);
        noteLoadedRef.current = true;
        reloadGate.markLoaded(startedAt);
      })
      .catch((error) => {
        if (!isCurrent()) return;
        // 404 真的不存在；其它失败都是网络/服务异常，应当让用户重试。
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setNote(null);
          setCollectionState(null);
          setDetailVerified(false);
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
  }, [id, noteStatusVersion, reloadGate, sessionEpoch, t]);

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

  // 名片只来自当前账号自己的笔记/已收藏副本，路由里的 ownerId 不授予可见性。
  const ownsNote = Boolean(note?.id === id && currentUserId &&
    (note?.canEdit === true || note?.ownerId === currentUserId));
  const privateCardNote = ownsNote ? note : addedNote ? collectionState?.note : null;
  useFocusEffect(useCallback(() => {
    if (!note || note.id !== id || ownsNote || !currentUserId || collectionRequestRef.current === collectionKey) return;
    let cancelled = false;
    const lookup = ++collectionLookupRef.current;
    void findCollectedNote(note.id, sessionEpoch).then((copy) => {
      if (cancelled || lookup !== collectionLookupRef.current || collectionRequestRef.current === collectionKey ||
          useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      setCollectionState(copy ? { key: collectionKey, status: 'added', note: copy } : null);
    }).catch((error) => {
      if (!cancelled) reportHandledFailure('notes', 'fetchCollectedCards', error);
    });
    return () => { cancelled = true; };
  }, [collectionKey, currentUserId, id, note, ownsNote, sessionEpoch]));
  const cardSections = useMemo(() => privateCardNote ? buildNoteSectionsWithCards(privateCardNote) : null, [privateCardNote]);
  const { contact, group } = useMemo(() => resolveNoteCardButtons(privateCardNote ?? {}), [privateCardNote]);
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
      groups: cardSections?.groups ?? { items: [] },
    };
  }, [cardSections, sections]);
  const readOnlyLayout = useMemo(
    () => stripNoteCardBlocks(note?.sections?.text?.contentJson ?? note?.contentJson ?? []),
    [note?.contentJson, note?.sections?.text?.contentJson],
  );
  const availability = useMemo(
    () => (readOnlySections ? getNoteSectionAvailability(readOnlySections) : null),
    [readOnlySections],
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
    // 已添加的群名片在正文展示；个人名片通过悬浮头像直接私聊。
    return [...new Set([...mapped, ...available])].filter(
      (kind) => available.has(kind),
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

  const measureImageViewport = useCallback(() => {
    scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
      if (mountedRef.current) imageViewport.setViewport(top, height);
    });
  }, [imageViewport]);
  const handleImageScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    imageViewport.setScrollOffset(event.nativeEvent.contentOffset.y);
  }, [imageViewport]);

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
      if (!note || !detailVerified || exporting) return;
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
    [detailVerified, exporting, note, saveLongImageExport, saveVideosDirectly, t],
  );

  // 分享单条笔记：打开会话选择器，把笔记以卡片消息发给好友/群聊。
  const [shareOpen, setShareOpen] = useState(false);
  const handleShareNote = useCallback(() => { if (detailVerified) setShareOpen(true); }, [detailVerified]);
  const shareRequest = useMemo<NoteShareRequest | null>(
    () =>
      shareOpen && note
        ? { notes: [{ ...note, ownerId: note.ownerId ?? ownerId }], options: NOTE_SHARE_CARD_ONLY }
        : null,
    [note, ownerId, shareOpen],
  );

  const canEditNote = useMemo(() => {
    if (!note || !detailVerified) return false;
    if (typeof note.canEdit === 'boolean') return note.canEdit;
    const resolvedOwnerId = note.ownerId ?? ownerId;
    return Boolean(resolvedOwnerId && currentUserId === resolvedOwnerId);
  }, [currentUserId, detailVerified, note, ownerId]);

  const hasChatSource = Boolean(sourceConversationId && sourceMessageId);
  const handleAddNote = useCallback(async () => {
    if (!note || !detailVerified || note.id !== id || !hasChatSource || canEditNote || addedNote ||
        collectionRequestRef.current === collectionKey) return;
    const isCurrentRequest = () => mountedRef.current &&
      currentCollectionKeyRef.current === collectionKey &&
      useAuthStore.getState().sessionEpoch === sessionEpoch;
    collectionRequestRef.current = collectionKey;
    collectionLookupRef.current += 1;
    setCollectionState({ key: collectionKey, status: 'adding' });
    const startedAt = diagnosticNow();
    let phaseStartedAt = startedAt;
    try {
      const source = await resolveNoteCollectSource(
        note.id, sourceConversationId, sourceMessageId, sourceMessageHeight,
      );
      if (!isCurrentRequest()) return;
      const sourceReadyAt = diagnosticNow();
      logClientDiagnostic('note.collect.phase', { stage: 'source', durationMs: Math.max(0, Math.round(sourceReadyAt - phaseStartedAt)) });
      phaseStartedAt = sourceReadyAt;
      if (!source) {
        recordMetric('app.operation.duration', Math.max(0, sourceReadyAt - startedAt), { operation: 'noteCollect', outcome: 'failed' });
        Alert.alert(t('notes.detail.addFailed'), t('notes.detail.addSourceUnavailable'));
        return;
      }
      const result = await collectNote(note.id, source);
      if (!isCurrentRequest()) return;
      const completedAt = diagnosticNow();
      logClientDiagnostic('note.collect.phase', { stage: 'request', durationMs: Math.max(0, Math.round(completedAt - phaseStartedAt)) });
      recordMetric('app.operation.duration', Math.max(0, completedAt - startedAt), { operation: 'noteCollect', outcome: 'success' });
      setCollectionState({ key: collectionKey, status: 'added', note: result.note });
      Alert.alert(
        t(result.alreadyCollected
          ? 'chat.messageActions.noteAlreadyCollected'
          : 'chat.messageActions.noteCollected'),
        t('chat.messageActions.noteCollectedHint'),
        [
          {
            text: t('common.view'),
            onPress: () => {
              if (!isCurrentRequest()) return;
              router.push({
                pathname: '/(tabs)/profile/notes',
                params: { highlightNoteId: result.note.id },
              } as never);
            },
          },
          { text: t('common.confirm') },
        ],
      );
    } catch (error) {
      if (!isCurrentRequest()) return;
      recordMetric('app.operation.duration', Math.max(0, diagnosticNow() - startedAt), { operation: 'noteCollect', outcome: 'failed' });
      reportHandledFailure('notes', 'collectNote', error);
      Alert.alert(
        t('notes.detail.addFailed'),
        getApiErrorMessage(error, t('chat.messageActions.collectFailedHint')),
      );
    } finally {
      if (collectionRequestRef.current === collectionKey) collectionRequestRef.current = null;
      if (isCurrentRequest()) {
        setCollectionState((state) => state?.key === collectionKey && state.status === 'adding'
          ? null : state);
      }
    }
  }, [addedNote, canEditNote, collectionKey, detailVerified, hasChatSource, id, note, router, sessionEpoch,
    sourceConversationId, sourceMessageHeight, sourceMessageId, t]);

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
            disabled={!detailVerified}
            accessibilityState={{ disabled: !detailVerified }}
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
          ) : hasChatSource ? (
            <Pressable
              style={[s.headerIconBtn, s.headerAddBtn, d.iconBtn]}
              onPress={() => void handleAddNote()}
              disabled={!detailVerified || addingNote || addedNote}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={t(addedNote ? 'notes.detail.added' : 'chat.messageActions.addToNotes')}
              accessibilityState={{ disabled: !detailVerified || addingNote || addedNote, busy: addingNote }}
            >
              {addingNote ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name={addedNote ? 'checkmark' : 'add'} size={18} color={colors.text} />
              )}
              <Text style={[s.headerAddLabel, d.meta]}>
                {t(addedNote ? 'notes.detail.added' : 'chat.messageActions.addToNotes')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {loadError ? <View style={{ paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm }}>
        <Text style={d.meta}>{loadError}</Text>
        <Pressable onPress={loadNote} accessibilityRole="button">
          <Text style={{ color: colors.primary }}>{t('common.retry', { defaultValue: '重试' })}</Text>
        </Pressable>
      </View> : null}
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + Spacing.xl + 48 + (contact ? 60 : 0) + (group ? 60 : 0) }]}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS === 'android'}
        onLayout={measureImageViewport}
        onScroll={handleImageScroll}
        scrollEventThrottle={64}
        onContentSizeChange={scrollToRequestedSection}
      >
        <NoteImageViewportContext.Provider value={imageViewport}>
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
        </NoteImageViewportContext.Provider>
      </ScrollView>

      {/* 已创建/已添加的笔记提供与列表一致的聊天入口。 */}
      {note ? (
        <View style={[s.floatingDock, { bottom: insets.bottom + Spacing.xl }]}>
          {contact ? (
            <Pressable
              testID="note-contact-chat"
              style={s.floatingAvatarBtn}
              accessibilityRole="button"
              accessibilityLabel={t('notes.list.openSenderChat', { name: contact.name })}
              onPress={() => {
                if (contact.id === currentUserId) {
                  Alert.alert(t('qr.thisIsYou'));
                  return;
                }
                router.push(getChatDetailHref(scope, contact.id, contact.name, contact.faceURL ?? undefined, contact.conversationID));
              }}
            >
              <Avatar size={FLOATING_AVATAR_SIZE} shape="circle" name={contact.name} uri={contact.faceURL ?? undefined} />
            </Pressable>
          ) : null}
          {group ? (
            <Pressable
              testID="note-group-chat"
              style={s.floatingAvatarBtn}
              accessibilityRole="button"
              accessibilityLabel={t('notes.list.openGroupChat', { name: group.name })}
              onPress={() => {
                if (group.target === 'circle') {
                  router.push(getCircleDetailHref(toCircleScope(scope), group.id));
                } else {
                  router.push(getGroupEntryHref(scope, { groupId: group.conversationID ?? group.id, searchedMsgID: group.clientMsgID }));
                }
              }}
            >
              <View style={s.floatingAvatar}>
                <GroupChatAvatar size={FLOATING_AVATAR_SIZE} name={group.name} uri={group.faceURL} />
              </View>
            </Pressable>
          ) : null}
          {/* 下载入口从顶栏移到这里：菜单内四种导出（图片/视频/长图/PDF）原样复用。 */}
          <Pressable
            style={[s.floatingBtn, d.floatingBtn, exporting !== null && s.floatingBtnBusy]}
            onPress={() => setDownloadMenuVisible(true)}
            disabled={!detailVerified || exporting !== null}
            accessibilityState={{ disabled: !detailVerified || exporting !== null }}
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
        request={shareRequest}
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

/** 右下角头像钮:48 的圆里头像铺满,只剩 1.5 的细白边。 */
const FLOATING_AVATAR_RING = 1.5;
const FLOATING_AVATAR_SIZE = 48 - FLOATING_AVATAR_RING * 2;

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
  headerAddBtn: { width: 'auto', flexDirection: 'row', gap: 4, paddingHorizontal: Spacing.sm },
  headerAddLabel: { ...Typography.small, fontWeight: '600' },
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
  floatingAvatarBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    // 头像铺满,只留一圈细白边把它和底下的图片分开(不再垫一圈粗底色)。
    borderWidth: FLOATING_AVATAR_RING,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  floatingAvatar: {
    width: FLOATING_AVATAR_SIZE,
    height: FLOATING_AVATAR_SIZE,
    borderRadius: Radius.full,
    overflow: 'hidden',
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
