import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LogBox,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteBlockEditor } from '@/features/notes/components/NoteBlockEditor';
import { VideoDraftPreview } from '@/features/notes/components/VideoDraftPreview';
import {
  BASEMAP_ATTRIBUTION,
  getOpenStreetMapPreviewTiles,
  hasValidLocationCoordinates,
} from '@/features/location/utils/location-map';
import { useNoteLocationPickerStore } from '@/features/notes/store/use-note-location-picker-store';
import type {
  CreateNoteMediaInput,
  EditorNoteMediaDraft,
  NoteGroup,
  NoteSections,
} from '@/features/notes/types';
import {
  extractPlainText,
} from '@/features/notes/utils/note-blocks';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { getNoteVideoUploadPolicyViolation } from '@/features/notes/utils/note-media-policy';
import {
  createPickerPreviewDisposer,
  splitPickerAssets,
} from '@/features/notes/utils/note-picker-assets';
import {
  buildNoteSections,
  normalizeNoteMediaSections,
  type StructuredNoteMediaItem,
} from '@/features/notes/utils/note-sections';
import {
  canSubmitNoteMedia,
  createNoteMediaUploadOperationGuard,
  createPendingNoteMediaDrafts,
  MAX_NOTE_MEDIA_SELECTION,
  partitionUnsettledDrafts,
  reconcileNoteMediaDrafts,
  stripEditorMediaDrafts,
  summarizeNoteMediaBatchFailure,
  uploadNoteMediaBatch,
} from '@/features/notes/utils/note-media-upload';
import {
  createNote,
  fetchNoteDetail,
  fetchNoteGroups,
  updateNote,
} from '@/services/api/notes';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

LogBox.ignoreLogs([
  "Calling the 'injectJavaScript' function has failed",
  'Unable to find the',
  'DomWebView',
]);

type LocationDraft = {
  title: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

type SectionMediaTarget = 'media' | 'showcase';
type SectionUploadKind = 'image' | 'video';
type UploadingSection = `${SectionMediaTarget}:${SectionUploadKind}` | null;

const VIDEO_UPLOAD_TIMEOUT_MS = 5 * 60_000;

function buildLocationDraft(location: NoteSections['location'] | undefined): LocationDraft {
  return {
    title: location?.title?.trim() ?? '',
    address: location?.address?.trim() ?? '',
    latitude: typeof location?.latitude === 'number' ? location.latitude : null,
    longitude: typeof location?.longitude === 'number' ? location.longitude : null,
  };
}

function hasLocationDraftValue(location: LocationDraft) {
  return Boolean(
    location.title.trim() ||
      location.address.trim() ||
      location.latitude != null ||
      location.longitude != null,
  );
}

const LOCATION_MAP_HEIGHT = 126;

function getTextOnlyBlocks(blocks: Record<string, unknown>[]) {
  return blocks.filter((block) => block.type !== 'image' && block.type !== 'video');
}

function normalizeSectionMedia(
  items: readonly StructuredNoteMediaItem[] | undefined,
) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is CreateNoteMediaInput =>
      Boolean(
        item &&
          typeof item.objectKey === 'string' &&
          typeof item.url === 'string' &&
          (item.type === 'IMAGE' || item.type === 'VIDEO'),
      ),
    )
    .map((item, index): EditorNoteMediaDraft => ({
      type: item.type,
      objectKey: item.objectKey,
      url: item.url,
      ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
      ...(typeof item.width === 'number' ? { width: item.width } : {}),
      ...(typeof item.height === 'number' ? { height: item.height } : {}),
      ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
      ...(typeof item.posterUrl === 'string' ? { posterUrl: item.posterUrl } : {}),
      clientId: `stored:${item.objectKey}:${item.url}`,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
      uploadStatus: 'UPLOADED',
    }));
}

function countUnrecoverableSectionMedia(items: readonly StructuredNoteMediaItem[]) {
  return items.filter(
    (item) => typeof item.objectKey !== 'string' || !item.objectKey.trim(),
  ).length;
}

function mergeMedia<T extends CreateNoteMediaInput>(items: T[]) {
  return items.reduce<T[]>((merged, item) => {
    const key = `${item.objectKey}:${item.url}`;
    if (merged.some((existing) => `${existing.objectKey}:${existing.url}` === key)) {
      return merged;
    }
    return [...merged, { ...item, sortOrder: merged.length }];
  }, []);
}

export default function EditNoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedMode } = useTheme();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [title, setTitle] = useState('');
  const blocksRef = useRef<Record<string, unknown>[]>([]);
  const [initialBlocks, setInitialBlocks] = useState<Record<string, unknown>[] | null>(null);
  const [availableGroups, setAvailableGroups] = useState<NoteGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  // 编辑时必须原样回传：后端 PATCH 对缺省 pinned 按 false 处理，
  // 不带的话「编辑一篇置顶笔记」会静默取消置顶。
  const pinnedRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  // 存时间戳而不是格式化后的字符串：日期文案随语言变，笔记的创建时刻不变。
  // 存字符串就得在加载 effect 里用 t 格式化，t 于是成了 effect 的依赖 —— 切一次
  // 语言就重新拉一遍这篇笔记，把没保存的编辑整个冲掉（见下面的加载 effect）。
  const [createdAtIso, setCreatedAtIso] = useState(() => new Date().toISOString());
  const dateStr = useMemo(
    () => formatNoteFullDate(createdAtIso, t),
    [createdAtIso, t],
  );
  const existingSectionsRef = useRef<Partial<NoteSections> | null>(null);
  const uploadInFlightRef = useRef(false);
  const uploadOperationGuardRef = useRef(createNoteMediaUploadOperationGuard());
  // 「结果还能不能写进这份列表」只看这一条：批次开始时是哪一篇笔记，落地时还得
  // 是同一篇。失去焦点（去选位置、去选分组）不属于这个判断 —— 那时列表还是同一
  // 份，把已经传完的对象丢掉纯粹是白扔用户刚等完的那几十秒。
  const editedNoteKeyRef = useRef<string>('');
  // 加载 effect 只在弹窗文案上用到 t。把它挪进 ref，effect 就不必依赖 t。
  const tRef = useRef(t);
  tRef.current = t;
  const pickerPreviewDisposerRef = useRef(createPickerPreviewDisposer());
  const saveGenerationRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const [editorMounted, setEditorMounted] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [mediaItems, setMediaItems] = useState<EditorNoteMediaDraft[]>([]);
  const [showcaseItems, setShowcaseItems] = useState<EditorNoteMediaDraft[]>([]);
  const [unrecoverableMediaCount, setUnrecoverableMediaCount] = useState(0);
  const [uploadingSection, setUploadingSection] = useState<UploadingSection>(null);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>({
    title: '',
    address: '',
    latitude: null,
    longitude: null,
  });
  // 底图瓦片来自第三方（basemaps.cartocdn.com）。挂在渲染里就意味着：只要打开
  // 一篇存过位置的笔记，精确坐标 + 本机的网络元数据就自动交给了对方，用户没做
  // 任何操作。与 chat 的位置卡片同一道门禁：显式点开才请求。
  //
  // 唯一的例外是本次会话里刚在选点页选好的位置 —— 那一页已经拉过一整屏瓦片，
  // 再让本人点一次「显示地图」只是把自己刚选的位置变成一块灰板。
  const [mapRevealed, setMapRevealed] = useState(false);
  // 瓦片要按像素绝对定位，需要一个具体宽度。预览卡片是撑满内容区的，所以量出来
  // 而不是把内边距抄一遍 —— 未展开时先渲染占位图，点开时宽度早已就绪。
  const [mapWidth, setMapWidth] = useState(0);
  const consumePickedLocation = useNoteLocationPickerStore(
    (state) => state.consumePickedLocation,
  );
  const isRouteDataReady = !isEdit || loadedNoteId === id;

  useEffect(() => () => pickerPreviewDisposerRef.current.disposeAll(), []);

  const invalidateUploadOwnership = useCallback(() => {
    uploadOperationGuardRef.current.invalidate();
    uploadInFlightRef.current = false;
  }, []);

  // 交回上传的「所有权」，但**不动**已经放进列表的草稿。
  //
  // 这里原本还会把在飞批次的占位图删掉。那正是丢文件的入口：失焦后回到本页时批次
  // 往往还没落地，占位图一删，等它落地时就没有东西可并 —— 已经传完、已经付过流量
  // 的对象凭空消失。批次落地时自己会收尾（成功的转 UPLOADED，失败的丢掉），那才是
  // 唯一该决定去留的地方。
  const resetUploadOwnership = useCallback(() => {
    invalidateUploadOwnership();
    setUploadingSection(null);
  }, [invalidateUploadOwnership]);

  useEffect(() => {
    if (!navigating) return;
    const timer = setTimeout(() => router.back(), 200);
    return () => clearTimeout(timer);
  }, [navigating, router]);

  useEffect(() => {
    editedNoteKeyRef.current = id ?? '';
    resetUploadOwnership();
    return invalidateUploadOwnership;
  }, [id, invalidateUploadOwnership, resetUploadOwnership]);

  useEffect(() => {
    const routeGeneration = ++saveGenerationRef.current;
    saveInFlightRef.current = false;
    setIsSubmitting(false);
    setNavigating(false);
    return () => {
      if (saveGenerationRef.current === routeGeneration) {
        saveGenerationRef.current += 1;
      }
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    fetchNoteGroups()
      .then((groups) => {
        if (!cancelled) setAvailableGroups(groups);
      })
      .catch(() => {
        if (!cancelled) setAvailableGroups([]);
      });

    if (!isEdit || !id) {
      existingSectionsRef.current = null;
      blocksRef.current = [];
      setInitialBlocks(null);
      setLoadedNoteId(null);
      pickerPreviewDisposerRef.current.disposeAll();
      setMediaItems([]);
      setShowcaseItems([]);
      setUnrecoverableMediaCount(0);
      setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
      setMapRevealed(false);
      setEditorMounted(true);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setLoadedNoteId(null);
    blocksRef.current = [];
    setInitialBlocks(null);
    setTitle('');
    pickerPreviewDisposerRef.current.disposeAll();
    setMediaItems([]);
    setShowcaseItems([]);
    setUnrecoverableMediaCount(0);
    setSelectedGroupIds([]);
    setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
    // 换一篇笔记就重新收起地图：上一篇是用户点开过的，不代表这一篇也同意了。
    setMapRevealed(false);
    pinnedRef.current = false;
    setEditorMounted(false);

    fetchNoteDetail(id)
      .then((note) => {
        if (cancelled) return;
        setTitle(note.title);
        existingSectionsRef.current = note.sections ?? null;

        const normalizedSections = buildNoteSections(note);
        const loaded = normalizedSections.text.contentJson ?? [];
        const textBlocks = getTextOnlyBlocks(loaded);

        blocksRef.current = textBlocks;
        setInitialBlocks(textBlocks.length > 0 ? textBlocks : null);
        setMediaItems(normalizeSectionMedia(normalizedSections.media.items));
        setShowcaseItems(normalizeSectionMedia(normalizedSections.showcase.items));
        setUnrecoverableMediaCount(
          countUnrecoverableSectionMedia([
            ...normalizedSections.media.items,
            ...normalizedSections.showcase.items,
          ]),
        );
        setLocationDraft(buildLocationDraft(note.sections?.location));
        setSelectedGroupIds(note.groups.map((group) => group.id));
        pinnedRef.current = note.pinned;
        setCreatedAtIso(note.createdAt);
        setLoadedNoteId(id);
        setLoading(false);
        setEditorMounted(true);
      })
      .catch((error) => {
        if (!cancelled) {
          existingSectionsRef.current = null;
          pickerPreviewDisposerRef.current.disposeAll();
          setMediaItems([]);
          setShowcaseItems([]);
          setUnrecoverableMediaCount(0);
          setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
          setLoadedNoteId(null);
          setLoading(false);
          setEditorMounted(true);
          // loadedNoteId 留在 null 上是有意的：正文没加载出来就允许保存，等于用空
          // 内容覆盖服务端的笔记。但失败必须说出来——否则用户面对的是一个空编辑器
          // 加一个永远点不动的「完成」，既没有报错也没有重试入口，线上也无声。
          reportHandledFailure('noteEditor', 'load', error);
          Alert.alert(
            tRef.current('notes.edit.loadFailedTitle', { defaultValue: '加载失败' }),
            tRef.current('notes.edit.loadFailedMessage', {
              defaultValue: '笔记加载失败，请返回后重试',
            }),
          );
        }
      });

    return () => {
      cancelled = true;
    };
    // t 刻意不在依赖里：切一次语言就会让这个 effect 重跑，setTitle('')、
    // setMediaItems([]) 再重新拉服务端版本 —— 作者没保存的编辑当场消失。effect
    // 里用到 t 的只有一条失败弹窗文案，走 tRef 取最新的即可。
  }, [id, isEdit]);

  useFocusEffect(
    useCallback(() => {
      resetUploadOwnership();
      const picked = consumePickedLocation();
      if (picked) {
        setLocationDraft({
          title: picked.title,
          address: picked.address,
          latitude: picked.latitude,
          longitude: picked.longitude,
        });
        // 门禁的例外：这份坐标是本人刚在选点页选的，那一页已经拉过一整屏瓦片，
        // 这里再要求点一次「显示地图」保护不到任何东西，只会让刚选完的位置显示
        // 成一块灰板。
        setMapRevealed(true);
      }
      return invalidateUploadOwnership;
    }, [consumePickedLocation, invalidateUploadOwnership, resetUploadOwnership]),
  );

  const handleContentChange = useCallback((newBlocks: Record<string, unknown>[]) => {
    blocksRef.current = getTextOnlyBlocks(newBlocks);
  }, []);

  const handleAddSectionMedia = useCallback(
    async ({
      target,
      kind,
    }: {
      target: SectionMediaTarget;
      kind: SectionUploadKind;
    }) => {
      if (!isRouteDataReady || uploadInFlightRef.current) return;
      uploadInFlightRef.current = true;
      const operationToken = uploadOperationGuardRef.current.begin();
      // 结果能否落库只认这一条：批次开始时编辑的是哪一篇笔记。
      const batchNoteKey = editedNoteKeyRef.current;
      let batchDraftIds: Set<string> = new Set();
      const stillEditingSameNote = () => editedNoteKeyRef.current === batchNoteKey;
      const uploadKey: UploadingSection = `${target}:${kind}`;
      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!uploadOperationGuardRef.current.isActive(operationToken)) return;
        if (!permission.granted) return;

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: kind === 'video' ? ['videos'] : ['images'],
          quality: 0.85,
          allowsMultipleSelection: true,
          selectionLimit: MAX_NOTE_MEDIA_SELECTION,
          orderedSelection: true,
        });
        const pickerAssets = result.assets ?? [];
        if (!uploadOperationGuardRef.current.isActive(operationToken)) {
          pickerPreviewDisposerRef.current.retainAssets(pickerAssets);
          pickerPreviewDisposerRef.current.disposeAssets(pickerAssets);
          return;
        }
        if (result.canceled || !pickerAssets.length) return;

        pickerPreviewDisposerRef.current.retainAssets(pickerAssets);
        const { selectedAssets, overflowAssets } = splitPickerAssets(pickerAssets);
        if (overflowAssets.length) {
          pickerPreviewDisposerRef.current.disposeAssets(overflowAssets);
          Alert.alert(
            t('notes.editor.selectionLimitExceededTitle', { defaultValue: '选择数量已达上限' }),
            t('notes.editor.selectionLimitExceededMessage', {
              defaultValue: '最多可选择 {{count}} 个文件，已忽略其余 {{overflow}} 个。',
              count: MAX_NOTE_MEDIA_SELECTION,
              overflow: overflowAssets.length,
            }),
          );
        }
        const acceptedAssets =
          kind === 'video'
            ? selectedAssets.filter(
                (asset) =>
                  !getNoteVideoUploadPolicyViolation({
                    fileSize: asset.fileSize,
                    duration: asset.duration,
                  }),
              )
            : selectedAssets;
        const rejectedAssets = selectedAssets.filter((asset) => !acceptedAssets.includes(asset));
        const rejectedCount = rejectedAssets.length;
        pickerPreviewDisposerRef.current.disposeAssets(rejectedAssets);
        if (rejectedCount) {
          Alert.alert(
            t('notes.editor.videoRejectedTitle', { defaultValue: '视频无法上传' }),
            t('notes.editor.videosRejectedMessage', {
              defaultValue: '已跳过 {{count}} 个不符合要求的视频',
              count: rejectedCount,
            }),
          );
        }

        // 「上传中…」直到这里才亮。此前是进函数就亮，而系统相册可以开着好几分钟：
        // 网页端对话框背后的页面仍然可见，作者一个文件都还没选，两个按钮就已经
        // 变成上传中并且全部禁用了。重入由 uploadInFlightRef 挡住，与这个标签无关。
        setUploadingSection(uploadKey);
        const pendingDrafts = createPendingNoteMediaDrafts(
          acceptedAssets,
          kind === 'video' ? 'VIDEO' : 'IMAGE',
        );
        batchDraftIds = new Set(pendingDrafts.map((item) => item.clientId));
        if (pendingDrafts.length) {
          const appendPending = (current: EditorNoteMediaDraft[]) => [
            ...current,
            ...pendingDrafts.map((item, index) => ({
              ...item,
              sortOrder: current.length + index,
            })),
          ];
          if (target === 'media') setMediaItems(appendPending);
          else setShowcaseItems(appendPending);
        }

        const batch = await uploadNoteMediaBatch(
          acceptedAssets.map((asset, index) => ({ asset, clientId: pendingDrafts[index].clientId })),
          async ({ asset, clientId }) => {
          const fallbackName = kind === 'video' ? 'video.mp4' : 'image.jpg';
          const fallbackType = kind === 'video' ? 'video/mp4' : 'image/jpeg';
          const filename = asset.uri.split('/').pop() ?? fallbackName;
          const contentType =
            resolveUploadContentType({ mimeType: asset.mimeType, fileName: filename }) ??
            fallbackType;
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(filename),
            contentType,
            folder: 'notes',
            fileUri: asset.uri,
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            asset.uri,
            presign.requiredHeaders,
            kind === 'video' ? VIDEO_UPLOAD_TIMEOUT_MS : undefined,
          );
          return {
            clientId,
            type: kind === 'video' ? 'VIDEO' : 'IMAGE',
            objectKey: presign.key,
            url: presign.fileUrl,
            width: asset.width ?? undefined,
            height: asset.height ?? undefined,
            mimeType: contentType,
            size: asset.fileSize ?? undefined,
            durationMs:
              kind === 'video' && typeof asset.duration === 'number'
                ? Math.round(asset.duration)
                : undefined,
            sortOrder: 0,
          };
        },
        );
        // 结果先落库，再谈 UI。此前这里先查「本次操作是否仍持有所有权」，失焦就
        // 直接 return —— 于是**已经传完**的对象被整批丢掉：字节已经躺在对象存储里，
        // 丢掉的是用户刚等完的那几十秒和一份已经付过的流量。所有权只管弹窗和按钮态。
        if (stillEditingSameNote()) {
          batch.failedIndexes.forEach((index) =>
            pickerPreviewDisposerRef.current.dispose(acceptedAssets[index]?.uri),
          );
          const commitBatch = (current: EditorNoteMediaDraft[]) =>
            reconcileNoteMediaDrafts(current, batch.items, batchDraftIds);
          if (target === 'media') setMediaItems(commitBatch);
          else setShowcaseItems(commitBatch);
        }
        if (!uploadOperationGuardRef.current.isActive(operationToken)) return;
        if (batch.failedCount) {
          const { error, errorNames } = summarizeNoteMediaBatchFailure(batch.errors);
          reportHandledFailure('noteEditor', 'sectionMediaUploadBatch', error, {
            failed: batch.failedCount,
            total: acceptedAssets.length,
            reason: `${target}.${kind}`,
            errorNames,
          });
          Alert.alert(
            t('notes.editor.mediaUploadFailedTitle', { defaultValue: '上传失败' }),
            t('notes.editor.mediaUploadsFailedMessage', {
              defaultValue: '{{count}} 个文件上传失败，请稍后重试',
              count: batch.failedCount,
            }),
          );
        }
      } catch (error) {
        // 同样先清理，再谈 UI：占位图不清掉就永远卡在 PENDING，保存按钮再也点不动。
        if (stillEditingSameNote()) {
          const discardUnsettled = (items: EditorNoteMediaDraft[]) => {
            // 只丢这一批里**还没传完**的。按 clientId 一刀切会把同批中已经成功、
            // 已经并回列表的那几条连同已上传的文件一起删掉。
            const { kept, discarded } = partitionUnsettledDrafts(items, batchDraftIds);
            for (const item of discarded) {
              pickerPreviewDisposerRef.current.dispose(item.previewUri);
            }
            return discarded.length ? kept : items;
          };
          if (target === 'media') setMediaItems(discardUnsettled);
          else setShowcaseItems(discardUnsettled);
        }
        // 上报也不看所有权：失焦时抛的错和在焦点里抛的错是同一个故障，只因为
        // 用户正好切走就在线上消失，等于给自己留了一片盲区。
        reportHandledFailure('noteEditor', 'sectionMediaUpload', error);
        if (!uploadOperationGuardRef.current.isActive(operationToken)) return;
        Alert.alert(
          t('notes.editor.mediaUploadFailedTitle', {
            defaultValue: '上传失败',
          }),
          t('notes.editor.mediaUploadFailedMessage', {
            defaultValue: '请稍后重试',
          }),
        );
      } finally {
        if (uploadOperationGuardRef.current.complete(operationToken)) {
          uploadInFlightRef.current = false;
          setUploadingSection(null);
        }
      }
    },
    [isRouteDataReady, t],
  );

  const handleRemoveSectionMedia = useCallback((target: SectionMediaTarget, clientId: string) => {
    const removeByClientId = (items: EditorNoteMediaDraft[]) =>
      items.filter((item) => {
        if (item.clientId === clientId) pickerPreviewDisposerRef.current.dispose(item.previewUri);
        return item.clientId !== clientId;
      })
        .map((item, index) => ({ ...item, sortOrder: index }));
    if (target === 'media') {
      setMediaItems((current) => removeByClientId(current));
    } else {
      setShowcaseItems((current) => removeByClientId(current));
    }
  }, []);

  const handleOpenLocationPicker = useCallback(() => {
    if (!isRouteDataReady || uploadInFlightRef.current) return;
    router.push({
      pathname: '/(tabs)/profile/notes/location-picker',
      params: {
        title: locationDraft.title,
        address: locationDraft.address,
        latitude: locationDraft.latitude != null ? String(locationDraft.latitude) : '',
        longitude: locationDraft.longitude != null ? String(locationDraft.longitude) : '',
      },
    } as never);
  }, [
    locationDraft,
    isRouteDataReady,
    router,
  ]);

  const handleClearLocation = useCallback(() => {
    setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
    // 清掉位置也把地图收回去：下一个位置要重新征得同意。
    setMapRevealed(false);
  }, []);

  const revealMap = useCallback(() => {
    setMapRevealed(true);
  }, []);

  const navigateBack = useCallback(() => {
    invalidateUploadOwnership();
    setEditorMounted(false);
    setNavigating(true);
  }, [invalidateUploadOwnership]);

  const toggleGroup = useCallback((groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (
      loading ||
      !isRouteDataReady ||
      isSubmitting ||
      saveInFlightRef.current ||
      uploadingSection !== null ||
      !canSubmitNoteMedia(mediaItems) ||
      !canSubmitNoteMedia(showcaseItems)
    )
      return;
    if (unrecoverableMediaCount) {
      Alert.alert(
        t('notes.edit.legacyMediaUnavailableTitle', { defaultValue: '无法安全保存媒体' }),
        t('notes.edit.legacyMediaUnavailableMessage', {
          defaultValue: '这篇笔记含有无法恢复的旧媒体。为避免丢失内容，请返回且不要保存。',
        }),
      );
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    saveInFlightRef.current = true;
    const saveGeneration = saveGenerationRef.current;
    setIsSubmitting(true);
    try {
      const currentBlocks = getTextOnlyBlocks(blocksRef.current);
      const plainText = extractPlainText(currentBlocks);
      const rawSectionMedia = stripEditorMediaDrafts(mergeMedia(mediaItems));
      const rawSectionShowcase = stripEditorMediaDrafts(mergeMedia(showcaseItems));
      const normalizedMediaSections = normalizeNoteMediaSections({
        media: rawSectionMedia,
        showcase: rawSectionShowcase,
      });
      const sectionMedia = stripEditorMediaDrafts(
        normalizeSectionMedia(normalizedMediaSections.media),
      );
      const sectionShowcase = stripEditorMediaDrafts(
        normalizeSectionMedia(normalizedMediaSections.showcase),
      );
      const legacyMedia = mergeMedia([...sectionMedia, ...sectionShowcase]);
      const nextLocation =
        hasLocationDraftValue(locationDraft)
          ? {
              title: locationDraft.title.trim() || null,
              address: locationDraft.address.trim() || null,
              latitude: locationDraft.latitude,
              longitude: locationDraft.longitude,
            }
          : null;
      const input = {
        title: trimmedTitle,
        content: plainText,
        contentJson: currentBlocks,
        sections: {
          text: { content: plainText, contentJson: currentBlocks },
          media: { items: sectionMedia },
          showcase: { items: sectionShowcase },
          location: nextLocation,
        },
        groupIds: selectedGroupIds,
        media: legacyMedia,
      };
      if (isEdit && id) {
        // 不带 status —— 后端按现状保留，避免把「已下架」笔记编辑一次就重新上架；
        // pinned 原样回传，防止编辑动作静默取消置顶。
        await updateNote(id, { ...input, pinned: pinnedRef.current });
      } else {
        await createNote({ ...input, status: 'ACTIVE' });
      }
      if (saveGenerationRef.current !== saveGeneration) return;
      navigateBack();
    } catch (error) {
      if (saveGenerationRef.current !== saveGeneration) return;
      saveInFlightRef.current = false;
      setIsSubmitting(false);
      const fallback = t('notes.edit.saveFailedMessage', {
        defaultValue: '保存失败，请稍后重试',
      });
      const message = getApiErrorMessage(error, fallback);
      Alert.alert(
        t('notes.edit.saveFailedTitle', { defaultValue: '保存失败' }),
        message,
      );
      reportHandledFailure('noteEditor', 'save', error);
    }
  }, [
    id,
    isEdit,
    isRouteDataReady,
    isSubmitting,
    locationDraft,
    mediaItems,
    navigateBack,
    selectedGroupIds,
    showcaseItems,
    t,
    title,
    uploadingSection,
    unrecoverableMediaCount,
    loading,
  ]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      headerTitle: { color: colors.text },
      doneBtn: { backgroundColor: colors.primary },
      doneBtnText: { color: colors.white },
      doneBtnDisabled: { backgroundColor: colors.primary, opacity: 0.5 },
      titleInput: { color: colors.text },
      dateText: { color: colors.textSecondary },
      groupChip: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      // 选中态用笔记品牌紫（与详情页分组标签同一支），不用靛蓝 primary
      groupChipActive: {
        backgroundColor: colors.brandPurple,
        borderColor: colors.brandPurple,
      },
      groupChipText: { color: colors.textSecondary },
      groupChipTextActive: { color: colors.white },
      sectionTitle: { color: colors.textSecondary },
      // 分区做成安静的卡片：surface 底 + 细边，取代原来贯穿全宽的分隔线
      sectionShell: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      editorFrame: { borderColor: colors.surfaceBorder },
      sectionHeading: { color: colors.text },
      sectionSubtitle: { color: colors.textSecondary },
      sectionHeaderMeta: { color: colors.textSecondary },
      mediaPreviewTile: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      mediaBadge: { backgroundColor: colors.background },
      mediaTitle: { color: colors.text },
      mediaMeta: { color: colors.textSecondary },
      emptyText: { color: colors.textSecondary },
      emptyTray: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      sectionAction: { borderColor: colors.surfaceBorder },
      sectionActionText: { color: colors.text },
      legacyMediaWarning: { borderColor: colors.warning },
      legacyMediaWarningText: { color: colors.text },
      locationPreviewCard: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      locationDetailLabel: { color: colors.textSecondary },
      locationClearAction: { borderColor: colors.surfaceBorder },
      locationClearText: { color: colors.textSecondary },
      locationMapFallback: { backgroundColor: colors.surface },
      locationMapRevealButton: { backgroundColor: colors.overlay },
      locationMapRevealText: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      locationMapMarkerDot: { backgroundColor: colors.primary },
      locationMapAttribution: {
        color: colors.textSecondary,
        backgroundColor: colors.overlay,
      },
    }),
    [colors],
  );

  const isDoneDisabled =
    loading ||
    !isRouteDataReady ||
    isSubmitting ||
    uploadingSection !== null ||
    !canSubmitNoteMedia(mediaItems) ||
    !canSubmitNoteMedia(showcaseItems) ||
    !title.trim();
  const hasLocationCoordinates = hasValidLocationCoordinates(
    locationDraft.latitude,
    locationDraft.longitude,
  );
  const mapPreview =
    hasLocationCoordinates && mapRevealed && mapWidth > 0
      ? getOpenStreetMapPreviewTiles(
          locationDraft.latitude as number,
          locationDraft.longitude as number,
          mapWidth,
          LOCATION_MAP_HEIGHT,
          15,
          { scheme: resolvedMode, retina: PixelRatio.get() > 1 },
        )
      : null;
  const hasLocation = hasLocationDraftValue(locationDraft);
  const mediaSectionStatus =
    uploadingSection?.startsWith('media:')
      ? t('notes.edit.mediaUploading', { defaultValue: '正在上传' })
      : `${mediaItems.length} ${t('notes.edit.itemsCount', { defaultValue: '项' })}`;
  const showcaseSectionStatus =
    uploadingSection?.startsWith('showcase:')
      ? t('notes.edit.mediaUploading', { defaultValue: '正在上传' })
      : `${showcaseItems.length} ${t('notes.edit.itemsCount', { defaultValue: '项' })}`;

  // 眉标式小节头：图标 + 标签 + 右侧计数，去掉解释性副标题让内容当主角。
  const renderSectionHeader = (
    icon: keyof typeof Ionicons.glyphMap,
    sectionTitle: string,
    meta?: string,
  ) => (
    <View style={s.sectionHeader}>
      <Ionicons name={icon} size={18} color={colors.iconAccent} />
      <Text style={[s.sectionHeading, d.sectionHeading]}>{sectionTitle}</Text>
      {meta ? (
        <Text style={[s.sectionHeaderMeta, d.sectionHeaderMeta]}>{meta}</Text>
      ) : null}
    </View>
  );

  const renderAddButton = useCallback((
    target: SectionMediaTarget,
    kind: SectionUploadKind,
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
  ) => {
    const uploadKey: UploadingSection = `${target}:${kind}`;
    const loadingLabel = t('notes.edit.uploading', { defaultValue: '上传中...' });
    return (
      <Pressable
        style={[s.sectionAction, d.sectionAction]}
        onPress={() => void handleAddSectionMedia({ target, kind })}
        disabled={!isRouteDataReady || uploadingSection !== null}
      >
        <Ionicons name={icon} size={17} color={colors.text} />
        <Text style={[s.sectionActionText, d.sectionActionText]}>
          {uploadingSection === uploadKey ? loadingLabel : label}
        </Text>
      </Pressable>
    );
  }, [colors.text, d.sectionAction, d.sectionActionText, handleAddSectionMedia, isRouteDataReady, t, uploadingSection]);

  const renderMediaList = useCallback((items: EditorNoteMediaDraft[], target: SectionMediaTarget) => {
    if (items.length === 0) {
      return (
        <View style={[s.emptyTray, d.emptyTray]}>
          <Ionicons name="add-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={[s.emptySectionText, d.emptyText]}>
            {t('notes.edit.emptySection', { defaultValue: '暂无内容' })}
          </Text>
        </View>
      );
    }
    return (
      <View style={s.mediaPreviewGrid}>
        {items.map((item) => {
          const thumbUri =
            item.type === 'VIDEO' ? item.posterUrl : item.previewUri ?? item.url;
          return (
            <View
              key={item.clientId}
              style={[s.mediaPreviewTile, d.mediaPreviewTile]}
            >
              {item.type === 'VIDEO' && item.previewUri ? (
                <VideoDraftPreview uri={item.previewUri} />
              ) : thumbUri ? (
                <Image
                  testID="note-media-preview-image"
                  source={{ uri: thumbUri }}
                  style={s.mediaThumb}
                  contentFit="cover"
                />
              ) : (
                <View
                  testID={item.type === 'VIDEO' ? 'note-media-video-fallback' : undefined}
                  style={s.mediaThumbFallback}
                >
                  <Ionicons
                    name={item.type === 'VIDEO' ? 'videocam-outline' : 'image-outline'}
                    size={24}
                    color={colors.iconAccent}
                  />
                </View>
              )}
              <View style={[s.mediaBadge, d.mediaBadge]}>
                <Ionicons
                  name={item.type === 'VIDEO' ? 'videocam' : 'image'}
                  size={13}
                  color={colors.text}
                />
                <Text style={[s.mediaMeta, d.mediaMeta]} numberOfLines={1}>
                  {item.type === 'VIDEO'
                    ? t('notes.edit.videoItem', { defaultValue: '视频' })
                    : t('notes.edit.imageItem', { defaultValue: '图片' })}
                </Text>
              </View>
              <Pressable
                style={s.mediaRemoveButton}
                onPress={() => handleRemoveSectionMedia(target, item.clientId)}
                hitSlop={8}
              >
                <Ionicons name="close" size={15} color={colors.text} />
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  }, [
    colors.iconAccent,
    colors.text,
    colors.textSecondary,
    d.emptyText,
    d.emptyTray,
    d.mediaBadge,
    d.mediaMeta,
    d.mediaPreviewTile,
    handleRemoveSectionMedia,
    t,
  ]);

  if (loading) {
    return (
      <View style={[s.container, d.container, s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.container, d.container, { paddingTop: insets.top }]}
      // 底部的位置输入框会被键盘盖住：iOS 用 padding 顶起，Android 交给系统 resize。
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.header}>
        <Pressable onPress={navigateBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, d.headerTitle]}>
          {isEdit
            ? t('notes.edit.editTitle', { defaultValue: '编辑笔记' })
            : t('notes.edit.newTitle', { defaultValue: '新建笔记' })}
        </Text>
        <Pressable
          style={[s.doneBtn, d.doneBtn, isDoneDisabled && d.doneBtnDisabled]}
          onPress={handleSubmit}
          disabled={isDoneDisabled}
        >
          <Text style={[s.doneBtnText, d.doneBtnText]}>
            {isSubmitting
              ? t('notes.edit.saving', { defaultValue: '保存中...' })
              : t('notes.edit.done', { defaultValue: '完成' })}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          style={[s.titleInput, d.titleInput]}
          placeholder={t('notes.edit.titlePlaceholder', { defaultValue: '标题' })}
          placeholderTextColor={colors.textSecondary}
          value={title}
          onChangeText={setTitle}
          maxLength={120}
          returnKeyType="next"
        />

        <View style={s.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <Text style={[s.dateText, d.dateText]}>{dateStr}</Text>
        </View>

        <View style={s.groupSection}>
          <View style={s.groupLabelRow}>
            <Ionicons
              name="folder-open-outline"
              size={14}
              color={colors.textSecondary}
            />
            <Text style={[s.sectionTitle, d.sectionTitle]}>
              {t('notes.edit.groupsLabel', { defaultValue: '分组' })}
            </Text>
          </View>
          <View style={s.groupChipsWrap}>
            {availableGroups.map((group) => {
              const selected = selectedGroupIds.includes(group.id);
              return (
                <Pressable
                  key={group.id}
                  style={[
                    s.groupChip,
                    d.groupChip,
                    selected ? [s.groupChipActive, d.groupChipActive] : null,
                  ]}
                  onPress={() => toggleGroup(group.id)}
                >
                  <Text
                    style={[
                      s.groupChipText,
                      d.groupChipText,
                      selected ? d.groupChipTextActive : null,
                    ]}
                  >
                    {group.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[s.sectionBlock, d.sectionShell]}>
          {renderSectionHeader(
            'text-outline',
            t('notes.edit.sections.text', { defaultValue: '文字' }),
            t('notes.edit.sections.required', { defaultValue: '必填' }),
          )}
          <View style={[s.textEditorFrame, d.editorFrame]}>
            {editorMounted ? (
              <NoteBlockEditor
                initialContent={initialBlocks}
                onContentChange={handleContentChange}
                mediaToolbarEnabled={false}
              />
            ) : null}
          </View>
        </View>

        {unrecoverableMediaCount > 0 ? (
          // 这些旧媒体在 sections 里只剩一个 url，附件表里也找不到对应的 objectKey，
          // 恢复不出来，因此既渲染不出来也删不掉。保存会把它们丢掉，所以「完成」被
          // 挡住了 —— 但此前这件事只在点「完成」时才弹一次，作者已经改完标题和正文
          // 才发现这篇笔记根本存不了。放在这里，一进页面就看得见。
          <View
            testID="note-unrecoverable-media-warning"
            style={[s.legacyMediaWarning, d.legacyMediaWarning]}
          >
            <Ionicons name="warning-outline" size={16} color={colors.warning} />
            <Text style={[s.legacyMediaWarningText, d.legacyMediaWarningText]}>
              {t('notes.edit.legacyMediaUnavailableInline', {
                defaultValue:
                  '这篇笔记有 {{count}} 项无法恢复的旧媒体，保存会丢失它们，请返回且不要保存。',
                count: unrecoverableMediaCount,
              })}
            </Text>
          </View>
        ) : null}

        <View style={[s.sectionBlock, d.sectionShell]}>
          {renderSectionHeader(
            'images-outline',
            t('notes.edit.sections.media', { defaultValue: '图片/视频' }),
            mediaSectionStatus,
          )}
          <View style={s.sectionActions}>
            {renderAddButton(
              'media',
              'image',
              t('notes.edit.addImage', { defaultValue: '添加图片' }),
              'image-outline',
            )}
            {renderAddButton(
              'media',
              'video',
              t('notes.edit.addVideo', { defaultValue: '添加视频' }),
              'videocam-outline',
            )}
          </View>
          {renderMediaList(mediaItems, 'media')}
        </View>

        <View style={[s.sectionBlock, d.sectionShell]}>
          {renderSectionHeader(
            'albums-outline',
            t('notes.edit.sections.showcase', { defaultValue: '展示' }),
            showcaseSectionStatus,
          )}
          <View style={s.sectionActions}>
            {renderAddButton(
              'showcase',
              'video',
              t('notes.edit.addShowcaseVideo', { defaultValue: '添加展示视频' }),
              'videocam-outline',
            )}
          </View>
          {renderMediaList(showcaseItems, 'showcase')}
        </View>

        <View style={[s.sectionBlock, d.sectionShell]}>
          {renderSectionHeader(
            'location-outline',
            t('notes.edit.sections.location', { defaultValue: '位置' }),
            hasLocation
              ? t('notes.edit.sections.locationSelected', { defaultValue: '已选择' })
              : t('notes.edit.sections.locationEmpty', { defaultValue: '可选' }),
          )}
          <View style={s.sectionActions}>
            <Pressable
              style={[s.sectionAction, d.sectionAction]}
              onPress={handleOpenLocationPicker}
              disabled={!isRouteDataReady || uploadingSection !== null}
            >
              <Ionicons name="map-outline" size={17} color={colors.text} />
              <Text style={[s.sectionActionText, d.sectionActionText]}>
                {t('notes.edit.pickLocation', { defaultValue: '选择位置' })}
              </Text>
            </Pressable>
          </View>
          {hasLocation ? (
            <View style={[s.locationPreviewCard, d.locationPreviewCard]}>
              <View
                testID="note-location-map"
                style={s.locationMapPreview}
                onLayout={(event) => setMapWidth(event.nativeEvent.layout.width)}
              >
                {mapPreview ? (
                  <>
                    {mapPreview.tiles.map((tile) => (
                      <Image
                        key={`${tile.url}:${tile.left}:${tile.top}`}
                        source={tile.url}
                        style={[s.locationMapTile, { left: tile.left, top: tile.top }]}
                        contentFit="cover"
                        transition={150}
                      />
                    ))}
                    <View pointerEvents="none" style={s.locationMapMarker}>
                      <View style={[s.locationMapMarkerDot, d.locationMapMarkerDot]}>
                        <Ionicons name="location" size={20} color={colors.white} />
                      </View>
                    </View>
                    <Text
                      pointerEvents="none"
                      style={[s.locationMapAttribution, d.locationMapAttribution]}
                    >
                      {BASEMAP_ATTRIBUTION}
                    </Text>
                  </>
                ) : (
                  <View style={[s.locationMapFallback, d.locationMapFallback]}>
                    <Ionicons name="location" size={28} color={colors.textSecondary} />
                    {hasLocationCoordinates ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={revealMap}
                        hitSlop={8}
                        style={[s.locationMapRevealButton, d.locationMapRevealButton]}
                      >
                        <Text style={d.locationMapRevealText}>
                          {t('chat.location.showPreview', {
                            defaultValue: '轻点显示地图',
                          })}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
              <View style={s.locationPreviewInfo}>
                <View style={s.locationPreviewTitleRow}>
                  <Ionicons name="location" size={16} color={colors.iconAccent} />
                  <Text style={[s.locationDetailLabel, d.locationDetailLabel]}>
                    {t('notes.edit.locationPlaceNameLabel', { defaultValue: '地点名称' })}
                  </Text>
                </View>
                <Text style={[s.mediaTitle, d.mediaTitle]} numberOfLines={1}>
                  {locationDraft.title ||
                    t('notes.edit.locationPreviewTitle', { defaultValue: '已选择位置' })}
                </Text>
                <Text style={[s.locationDetailLabel, d.locationDetailLabel]}>
                  {t('notes.edit.locationAddressLabel', { defaultValue: '详细地址' })}
                </Text>
                <Text style={[s.mediaMeta, d.mediaMeta]} numberOfLines={2}>
                  {locationDraft.address ||
                    t('notes.edit.locationAddressUnavailable', { defaultValue: '未提供' })}
                </Text>
                <View style={s.locationClearRow}>
                  <Pressable
                    style={[s.locationClearAction, d.locationClearAction]}
                    onPress={handleClearLocation}
                    accessibilityLabel={t('notes.edit.clearLocation', { defaultValue: '清除位置' })}
                    accessibilityRole="button"
                  >
                    <Ionicons name="close-circle-outline" size={16} color={colors.textSecondary} />
                    <Text style={[s.locationClearText, d.locationClearText]}>
                      {t('notes.edit.clearLocation', { defaultValue: '清除位置' })}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    height: 52,
    gap: Spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    ...Typography.h3,
    fontWeight: '600',
  },
  doneBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  doneBtnText: { ...Typography.body, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: Spacing.md },
  titleInput: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 36,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
    paddingBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  dateText: { ...Typography.caption },
  groupSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  groupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  sectionTitle: { ...Typography.small },
  groupChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    rowGap: Spacing.xs,
  },
  groupChip: {
    borderWidth: 1,
    // 方形（与详情页分组标签一致）
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 5,
  },
  groupChipActive: { borderWidth: 1 },
  groupChipText: { ...Typography.small, fontWeight: '600' },
  sectionBlock: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
  },
  sectionHeading: {
    flex: 1,
    // 与详情页小节标题同档（h3/700），编辑页分段更醒目。
    ...Typography.h3,
    fontWeight: '700',
  },
  sectionSubtitle: { ...Typography.small },
  sectionHeaderMeta: { ...Typography.small },
  textEditorFrame: {
    height: 320,
    minHeight: 320,
    overflow: 'hidden',
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  legacyMediaWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
  },
  legacyMediaWarningText: { ...Typography.small, flex: 1, lineHeight: 18 },
  sectionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  sectionAction: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    gap: Spacing.xs,
  },
  sectionActionText: { ...Typography.small, fontWeight: '600' },
  mediaPreviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  mediaPreviewTile: {
    width: '31%',
    minWidth: 96,
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  mediaThumb: {
    width: '100%',
    height: '100%',
  },
  mediaThumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaBadge: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    minHeight: 24,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mediaRemoveButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  emptyTray: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  mediaTitle: { ...Typography.caption, fontWeight: '700' },
  mediaMeta: { ...Typography.small },
  emptySectionText: { ...Typography.small },
  locationPreviewCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  locationMapPreview: {
    width: '100%',
    height: LOCATION_MAP_HEIGHT,
    overflow: 'hidden',
  },
  locationMapTile: {
    position: 'absolute',
    width: 256,
    height: 256,
  },
  locationMapMarker: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationMapMarkerDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationMapAttribution: {
    position: 'absolute',
    right: 4,
    bottom: 2,
    paddingHorizontal: 3,
    paddingVertical: 1,
    fontSize: 8,
    borderRadius: 3,
  },
  locationMapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  locationMapRevealButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  locationPreviewInfo: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  locationPreviewTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  locationDetailLabel: { ...Typography.small, fontWeight: '600' },
  locationClearRow: { alignItems: 'flex-end', paddingTop: Spacing.xs },
  locationClearAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 44,
  },
  locationClearText: { ...Typography.small, fontWeight: '600' },
});
