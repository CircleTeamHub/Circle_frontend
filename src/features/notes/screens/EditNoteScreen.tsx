import { Ionicons } from '@expo/vector-icons';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Platform,
  InteractionManager,
  LogBox,
  Modal,
  PanResponder,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useNavigation,
  usePreventRemove,
} from '@react-navigation/native';
import type { NavigationAction } from '@react-navigation/core';
import type { FriendProfile } from '@/services/api/friends';
import { useAuthStore } from '@/stores/authStore';
import { NoteBlockEditor } from '@/features/notes/components/NoteBlockEditor';
import { NoteDocumentBody } from '@/features/notes/components/NoteDocumentBody';
import { NoteTextStatsConsumer } from '@/features/notes/components/NoteTextStatsConsumer';
import {
  GROUP_NAME_MAX_LENGTH,
  MAX_NOTE_GROUPS,
} from '@/features/notes/constants';
import { VideoDraftPreview } from '@/features/notes/components/VideoDraftPreview';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { ImageViewer } from '@/components/ui/image-viewer';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
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
  NoteDraftDetail,
  NoteSections,
} from '@/features/notes/types';
import {
  extractPlainText,
} from '@/features/notes/utils/note-blocks';
import {
  createNoteTextStatsStore,
  getNoteTextLimitKind,
  getNoteTextStats,
  MAX_NOTE_TEXT_BLOCKS,
  MAX_NOTE_TEXT_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  type NoteTextStats,
} from '@/features/notes/utils/note-text-stats';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { getNoteVideoUploadPolicyViolation } from '@/features/notes/utils/note-media-policy';
import {
  createPickerPreviewDisposer,
  splitPickerAssets,
} from '@/features/notes/utils/note-picker-assets';
import {
  buildNoteSections,
  getNoteInlineMediaItems,
  getNoteViewerImages,
  normalizeNoteMediaSections,
  type NoteSectionKind,
  type StructuredNoteMediaItem,
} from '@/features/notes/utils/note-sections';
import {
  getCachedNotePickerCircles,
  getCachedNotePickerFriends,
  isNotePickerCirclesFresh,
  isNotePickerFriendsFresh,
  loadNotePickerCircles,
  loadNotePickerFriends,
  prefetchNoteCardPickerData,
  type NoteCardPickerCircle,
} from '@/features/notes/utils/note-card-picker-cache';
import {
  buildNoteComposerBlocksMetadata,
  normalizeNoteComposerBlocks,
  readNoteComposerBlocks,
  readNoteComposerMediaBlocks,
  readNoteComposerTextBlocks,
  stripNoteComposerMetadata,
  isNoteComposerSingletonKind,
  type NoteComposerBlock,
  type NoteComposerBlockKind,
} from '@/features/notes/utils/note-composer';
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
  createNoteGroup,
  fetchNoteDraft,
  fetchNoteDetail,
  fetchNoteGroups,
  saveNoteDraft,
  deleteNoteDraft,
  updateNote,
} from '@/services/api/notes';
import {
  createNoteDraftId,
  loadLocalNoteDraft,
  localDraftSummaryToServerInput,
  sanitizeNoteSectionsForServer,
  removeLocalNoteDraft,
  removeUnreferencedLocalNoteRecordings,
  saveLocalNoteDraft,
  restoreLocalNoteDraftRecordings,
  refreshLocalNoteDraftMedia,
  isLocalNoteDraftDeleted,
  stageLocalNoteDraftDeletion,
  finishLocalNoteDraftDeletion,
  confirmNoteDraftDeletion,
  retainDeletedNoteDraftRecording,
  type NoteEditorDraftRecord,
} from '@/features/notes/utils/note-editor-drafts';
import { persistNoteRecording } from '@/features/notes/utils/note-recording-storage';
import { stopNoteRecorder } from '@/features/notes/utils/note-recorder-lifecycle';
import { createPendingNoteSubmission, isDefinitiveNoteSubmissionFailure, noteSubmissionMatchesResult, type PendingNoteSubmission } from '@/features/notes/utils/note-submission';
import { createNoteDraftSaveQueue } from '@/features/notes/utils/note-draft-save-queue';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';
import { VOICE_RECORDING_OPTIONS } from '@/features/chat/utils/voice-recording-options';

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

type NoteCardDraft = {
  id: string;
  name: string;
  faceURL: string | null;
  avatarUrl?: string | null;
};
type ContactPickerItem = {
  id: string;
  name: string;
  avatarUrl: string | null;
  subtitle: string | null;
  searchText: string;
};
type CardPickerKind = 'contact' | 'group';
type NotePreviewData = {
  sections: ReturnType<typeof buildNoteSections>;
  imageItems: { uri: string; objectKey?: string }[];
  sectionOrder: NoteSectionKind[];
  layout: Record<string, unknown>[];
};

function getNoteCardAvatar(card: NoteCardDraft) {
  return card.faceURL || card.avatarUrl || null;
}

type SectionMediaTarget = 'media' | 'showcase';
type SectionUploadKind = 'media' | 'image' | 'video';
type UploadingSection = `${SectionMediaTarget}:${SectionUploadKind}` | 'audio' | null;

const COMPOSER_ACTIONS: readonly {
  kind: NoteComposerBlockKind;
  icon: keyof typeof Ionicons.glyphMap;
  translationKey: string;
  defaultLabel: string;
}[] = [
  { kind: 'text', icon: 'text', translationKey: 'text', defaultLabel: '文字' },
  { kind: 'image', icon: 'images-outline', translationKey: 'media', defaultLabel: '多媒体' },
  { kind: 'audio', icon: 'mic-outline', translationKey: 'audio', defaultLabel: '录音' },
  { kind: 'showcase', icon: 'play-circle-outline', translationKey: 'showcase', defaultLabel: '展示' },
  { kind: 'location', icon: 'location-outline', translationKey: 'location', defaultLabel: '位置' },
  { kind: 'contact', icon: 'person-outline', translationKey: 'contact', defaultLabel: '名片' },
  { kind: 'group', icon: 'people-outline', translationKey: 'group', defaultLabel: '群名片' },
];

const FIXED_TITLE_BLOCK: NoteComposerBlock = { id: 'title-fixed', kind: 'title' };

const COMPOSER_SORT_ROW_HEIGHT = 58;

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
  return blocks.filter(
    (block) =>
      Boolean(block && typeof block === 'object') &&
      block.type !== 'image' &&
      block.type !== 'video' &&
      block.type !== 'noteLayout',
  );
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
          (item.type === 'IMAGE' || item.type === 'VIDEO' || item.type === 'AUDIO'),
      ),
    )
    .map((item, index): EditorNoteMediaDraft => ({
      type: item.type,
      objectKey: item.objectKey,
      // 私有目录的新上传没有 url：留空而不是补一个读不到的地址。
      ...(typeof item.url === 'string' ? { url: item.url } : {}),
      ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
      ...(typeof item.width === 'number' ? { width: item.width } : {}),
      ...(typeof item.height === 'number' ? { height: item.height } : {}),
      ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
      ...(typeof item.posterUrl === 'string' ? { posterUrl: item.posterUrl } : {}),
      clientId: `stored:${item.objectKey}:${item.url ?? ''}`,
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
    const key = `${item.objectKey}:${item.url ?? ''}`;
    if (merged.some((existing) => `${existing.objectKey}:${existing.url ?? ''}` === key)) {
      return merged;
    }
    return [...merged, { ...item, sortOrder: merged.length }];
  }, []);
}

export function draftFingerprint(record: NoteEditorDraftRecord): string {
  const mediaSnapshot = (items: EditorNoteMediaDraft[]) => items.map((item) => ({
    type: item.type, objectKey: item.objectKey, mimeType: item.mimeType, size: item.size,
    width: item.width, height: item.height, durationMs: item.durationMs,
    posterUrl: item.posterUrl?.split('?')[0], sortOrder: item.sortOrder,
    owner: record.mediaOwnerByClientId[item.clientId],
    pendingSource: item.objectKey ? undefined : item.localRecordingId ?? item.previewUri ?? item.url,
  }));
  // Derived sections, signed URLs and transient client IDs do not represent edits.
  return JSON.stringify({
    title: record.title, composerBlocks: record.composerBlocks,
    textBlocksById: record.textBlocksById, groupIds: record.groupIds,
    mediaItems: mediaSnapshot(record.mediaItems), showcaseItems: mediaSnapshot(record.showcaseItems),
    audioItems: mediaSnapshot(record.audioItems), contactItems: record.contactItems,
    groupCardItems: record.groupCardItems, location: record.location,
  });
}

export function draftRecordFromServer(
  draft: NoteDraftDetail,
  draftId: string,
): NoteEditorDraftRecord {
  const rawBlocks = draft.sections?.text?.contentJson ?? draft.contentJson ?? [];
  const topLevelMedia = getNoteInlineMediaItems(rawBlocks.map((block) => ({ ...block, children: [] })));
  const sections = buildNoteSections({ ...draft, media: topLevelMedia });
  const normalizedComposerBlocks = (
    readNoteComposerBlocks(rawBlocks) ??
    normalizeNoteComposerBlocks(null, sections as Partial<NoteSections>, true)
  ).filter((block) => block.kind !== 'title');
  const normalizedMedia = normalizeSectionMedia(
    (sections.media?.items ?? []) as StructuredNoteMediaItem[],
  );
  const normalizedShowcase = normalizeSectionMedia(
    (sections.showcase?.items ?? []) as StructuredNoteMediaItem[],
  );
  const normalizedAudio = normalizeSectionMedia(
    (sections.audio?.items ?? []) as StructuredNoteMediaItem[],
  );
  const loaded = stripNoteComposerMetadata(sections.text?.contentJson ?? draft.contentJson ?? []);
  const loadedTextBlocks = getTextOnlyBlocks(loaded);
  const textContent = sections.text?.content ?? draft.content ?? '';
  const fallbackText =
    textContent && extractPlainText(loadedTextBlocks).trim() === ''
      ? [{ type: 'paragraph', content: [{ type: 'text', text: textContent, styles: {} }] }]
      : loadedTextBlocks;
  const savedTextBlocks = readNoteComposerTextBlocks(rawBlocks);
  const textBlocksById = Object.fromEntries(
    normalizedComposerBlocks
      .filter((block) => block.kind === 'text')
      .map((block, index) => [
        block.id,
        savedTextBlocks?.find((item) => item.id === block.id)?.content ??
          (index === 0 ? fallbackText : []),
      ]),
  ) as Record<string, Record<string, unknown>[]>;
  const firstMediaBlockId = normalizedComposerBlocks.find(
    (block) => block.kind === 'image' || block.kind === 'video',
  )?.id;
  const firstShowcaseBlockId = normalizedComposerBlocks.find(
    (block) => block.kind === 'showcase',
  )?.id;
  const mediaOwnerByClientId: Record<string, string> = {};
  if (firstMediaBlockId) {
    normalizedMedia.forEach((item) => {
      mediaOwnerByClientId[item.clientId] = firstMediaBlockId;
    });
  }
  if (firstShowcaseBlockId) {
    normalizedShowcase.forEach((item) => {
      mediaOwnerByClientId[item.clientId] = firstShowcaseBlockId;
    });
  }
  for (const block of readNoteComposerMediaBlocks(rawBlocks)) {
    if (!normalizedComposerBlocks.some((item) => item.id === block.id &&
      (block.target === 'showcase' ? item.kind === 'showcase' : item.kind === 'image' || item.kind === 'video'))) continue;
    const keys = new Set(block.objectKeys);
    const items = block.target === 'showcase' ? normalizedShowcase : normalizedMedia;
    for (const item of items) {
      if (keys.has(item.objectKey)) mediaOwnerByClientId[item.clientId] = block.id;
    }
  }
  return {
    version: 1,
    id: draftId,
    noteId: draft.sourceNoteId ?? null,
    title: draft.title ?? '',
    content: textContent,
    contentJson: (draft.contentJson ?? []) as Record<string, unknown>[],
    sections: { ...sections, media: { items: normalizedMedia }, showcase: { items: normalizedShowcase }, audio: { items: normalizedAudio } },
    groupIds: draft.groupIds ?? [],
    mediaKeys: draft.mediaKeys ?? [],
    composerBlocks: normalizedComposerBlocks,
    textBlocksById,
    mediaItems: normalizedMedia,
    showcaseItems: normalizedShowcase,
    audioItems: normalizedAudio,
    mediaOwnerByClientId,
    contactItems: ((sections.contacts?.items ?? []) as NoteCardDraft[]),
    groupCardItems: ((sections.groups?.items ?? []) as NoteCardDraft[]),
    location: buildLocationDraft(sections.location),
    createdAt: Date.parse(draft.createdAt) || Date.now(),
    updatedAt: Date.parse(draft.updatedAt) || Date.now(),
  };
}

function emptyDraftRecord(id: string, noteId: string | null): NoteEditorDraftRecord {
  return {
    version: 1,
    id,
    noteId,
    title: '',
    content: '',
    contentJson: [],
    sections: {
      text: { content: '', contentJson: [] },
      media: { items: [] },
      showcase: { items: [] },
      audio: { items: [] },
      contacts: { items: [] },
      groups: { items: [] },
      location: null,
    },
    groupIds: [],
    mediaKeys: [],
    composerBlocks: [],
    textBlocksById: {},
    mediaItems: [],
    showcaseItems: [],
    audioItems: [],
    mediaOwnerByClientId: {},
    contactItems: [],
    groupCardItems: [],
    location: { title: '', address: '', latitude: null, longitude: null },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

let noteRecorderWork: Promise<unknown> = Promise.resolve();
function runNoteRecorderWork<T>(work: () => Promise<T>): Promise<T> {
  const pending = noteRecorderWork.catch(() => undefined).then(work);
  noteRecorderWork = pending.catch(() => undefined);
  return pending;
}

export default function EditNoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedMode } = useTheme();
  const { t } = useTranslation();
  const currentUser = useAuthStore((state) => state.user);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const { id, draftId: routeDraftId, draftMode } = useLocalSearchParams<{
    id?: string;
    draftId?: string;
    draftMode?: string;
  }>();
  const isEdit = Boolean(id);
  const navigation = useNavigation();
  const editorContext = `${currentUser?.id ?? 'anonymous'}:${sessionEpoch}:${id ?? 'new'}`;
  const generatedDraftRef = useRef<{ context: string; id: string } | null>(null);
  if (generatedDraftRef.current?.context !== editorContext) {
    // A fresh edit cannot reuse an ID that a previous save/discard consumed.
    // DraftsScreen supplies an explicit routeDraftId when resuming a draft.
    generatedDraftRef.current = { context: editorContext, id: createNoteDraftId() };
  }
  const editorDraftId = (typeof routeDraftId === 'string' && routeDraftId.trim()) || generatedDraftRef.current.id;
  const draftRouteKey = `${currentUser?.id ?? 'anonymous'}:${sessionEpoch}:${id ?? 'new'}:${editorDraftId}`;
  const draftRouteKeyRef = useRef(draftRouteKey);
  draftRouteKeyRef.current = draftRouteKey;
  // A queue belongs to one account/route lifecycle, including its debounce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const draftRemoteQueue = useMemo(() => createNoteDraftSaveQueue(), [draftRouteKey]);
  useEffect(() => () => draftRemoteQueue.cancel(), [draftRemoteQueue]);

  const [title, setTitle] = useState('');
  const titleInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  // 正文统计走独立的小 store，不进本组件的 state —— 见 note-text-stats.ts 的注释。
  const [textStatsStore] = useState(createNoteTextStatsStore);
  const textBlocksByIdRef = useRef<Record<string, Record<string, unknown>[]>>({});
  const [textBlocksById, setTextBlocksById] = useState<Record<string, Record<string, unknown>[]>>({});
  const [availableGroups, setAvailableGroups] = useState<NoteGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupSheetVisible, setGroupSheetVisible] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupCreateName, setGroupCreateName] = useState('');
  const [groupCreating, setGroupCreating] = useState(false);
  const groupCreateRequestRef = useRef(0);
  const groupCreateInputRef = useRef<TextInput>(null);
  // 编辑时必须原样回传：后端 PATCH 对缺省 pinned 按 false 处理，
  // 不带的话「编辑一篇置顶笔记」会静默取消置顶。
  const pinnedRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<PendingNoteSubmission | null>(null);
  const pendingSubmissionRef = useRef<PendingNoteSubmission | null>(null);
  const isEditingLocked = isSubmitting || pendingSubmission !== null;
  const [loading, setLoading] = useState(isEdit);
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const [settledRouteKey, setSettledRouteKey] = useState<string | null>(null);
  const [draftHydratedKey, setDraftHydratedKey] = useState<string | null>(null);
  const draftHydratedRef = useRef(false);
  const baselineFingerprintRef = useRef<string | null>(null);
  const draftPersistedFingerprintRef = useRef<string | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTextSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSavePromiseRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const draftWriteVersionRef = useRef(0);
  const successfulDraftWriteVersionRef = useRef(0);
  const [, setDraftPersistenceVersion] = useState(0);
  const navigationRequestedRef = useRef(false);
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
  const discardRecordingOutput = useCallback((uri: string | undefined) => {
    pickerPreviewDisposerRef.current.retain(uri);
    pickerPreviewDisposerRef.current.dispose(uri);
  }, []);
  const saveGenerationRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const [editorMounted, setEditorMounted] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [mediaItems, setMediaItems] = useState<EditorNoteMediaDraft[]>([]);
  const [showcaseItems, setShowcaseItems] = useState<EditorNoteMediaDraft[]>([]);
  const [audioItems, setAudioItems] = useState<EditorNoteMediaDraft[]>([]);
  const mediaOwnerByClientIdRef = useRef<Record<string, string>>({});
  const [mediaOwnerByClientId, setMediaOwnerByClientId] = useState<Record<string, string>>({});
  const [contactItems, setContactItems] = useState<NoteCardDraft[]>([]);
  const [groupCardItems, setGroupCardItems] = useState<NoteCardDraft[]>([]);
  const [cardPickerKind, setCardPickerKind] = useState<CardPickerKind | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [circles, setCircles] = useState<NoteCardPickerCircle[]>([]);
  const [cardPickerLoading, setCardPickerLoading] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [cardPickerSearch, setCardPickerSearch] = useState('');
  const cardPickerRequestRef = useRef(0);
  const cardPickerSessionRef = useRef<{ userId: string | null; epoch: number } | null>(null);
  useEffect(() => {
    cardPickerRequestRef.current += 1;
    cardPickerSessionRef.current = null;
    setFriends([]);
    setCircles([]);
    setSelectedCardIds([]);
    setCardPickerKind(null);
    setCardPickerLoading(false);
    return () => {
      cardPickerRequestRef.current += 1;
      cardPickerSessionRef.current = null;
    };
  }, [currentUser?.id, sessionEpoch]);
  const noteRecorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const [recordingAudioStartedAt, setRecordingAudioStartedAt] = useState<number | null>(null);
  const recordingAudioRef = useRef(false);
  const preparingAudioRef = useRef(false);
  const recordingAudioBlockIdRef = useRef<string | null>(null);
  // A new note starts as a clean canvas. Blocks are mounted only after the
  // author chooses them from the compact toolbar below.
  const [composerBlocks, setComposerBlocks] = useState<NoteComposerBlock[]>([]);
  const composerIdRef = useRef(0);
  const [sortMode, setSortMode] = useState(false);
  const composerBlocksRef = useRef<NoteComposerBlock[]>([]);
  const [draggingComposerBlockId, setDraggingComposerBlockId] = useState<string | null>(null);
  const [composerDragStartIndex, setComposerDragStartIndex] = useState<number | null>(null);
  const [composerDragActiveIndex, setComposerDragActiveIndex] = useState<number | null>(null);
  const composerDragY = useRef(new Animated.Value(0)).current;
  const composerDragMetaRef = useRef<{
    blockId: string;
    startIndex: number;
    activeIndex: number;
  } | null>(null);
  const composerDragRespondersRef = useRef(
    new Map<string, ReturnType<typeof PanResponder.create>>(),
  );
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewContentReady, setPreviewContentReady] = useState(false);
  const previewDataSnapshotRef = useRef<NotePreviewData | null>(null);
  const [previewDataVersion, setPreviewDataVersion] = useState(0);
  const previewVisibleRef = useRef(previewVisible);
  previewVisibleRef.current = previewVisible;
  const previewReadyTaskRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
  const [previewImageViewerVisible, setPreviewImageViewerVisible] = useState(false);
  const [previewImageViewerIndex, setPreviewImageViewerIndex] = useState(0);
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
  const isDraftLoading = Boolean(currentUser?.id && draftHydratedKey !== draftRouteKey);
  const isRouteDataReady = (!isEdit || loadedNoteId === id || pendingSubmission?.noteId === id) && !isDraftLoading;

  useEffect(() => {
    if (!isRouteDataReady || !currentUser?.id) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void prefetchNoteCardPickerData(currentUser.id);
    });
    return () => task.cancel();
  }, [currentUser?.id, isRouteDataReady]);

  const contactPickerItems = useMemo<ContactPickerItem[]>(() => {
    const selfLabel = t('chat.self', { defaultValue: '自己' });
    const byId = new Map<string, ContactPickerItem>();

    if (currentUser) {
      const name = currentUser.nickname?.trim() || selfLabel;
      byId.set(currentUser.id, {
        id: currentUser.id,
        name,
        avatarUrl: currentUser.avatarUrl,
        subtitle: selfLabel,
        searchText: `${name} ${currentUser.accountId} ${selfLabel}`.toLocaleLowerCase(),
      });
    }

    for (const friend of friends) {
      if (byId.has(friend.id)) continue;
      const name = friend.remark?.trim() || friend.nickname?.trim() || friend.accountId;
      const subtitle = friend.remark?.trim() && friend.remark.trim() !== friend.nickname.trim()
        ? friend.nickname
        : friend.accountId;
      byId.set(friend.id, {
        id: friend.id,
        name,
        avatarUrl: friend.avatarUrl,
        subtitle: subtitle || null,
        searchText: `${name} ${friend.nickname} ${friend.accountId}`.toLocaleLowerCase(),
      });
    }

    return [...byId.values()];
  }, [currentUser, friends, t]);

  const cardPickerSearchTerm = cardPickerSearch.trim().toLocaleLowerCase();
  const filteredContactPickerItems = useMemo(
    () => contactPickerItems.filter((item) => !cardPickerSearchTerm || item.searchText.includes(cardPickerSearchTerm)),
    [cardPickerSearchTerm, contactPickerItems],
  );
  const filteredCircleItems = useMemo(
    () => circles.filter((circle) => !cardPickerSearchTerm || circle.name.toLocaleLowerCase().includes(cardPickerSearchTerm)),
    [cardPickerSearchTerm, circles],
  );

  useEffect(() => {
    composerBlocksRef.current = composerBlocks;
  }, [composerBlocks]);

  const finishComposerDrag = useCallback(() => {
    const meta = composerDragMetaRef.current;
    if (meta && !pendingSubmissionRef.current && !saveInFlightRef.current) {
      const currentBlocks = composerBlocksRef.current;
      const currentIndex = currentBlocks.findIndex((block) => block.id === meta.blockId);
      if (currentIndex >= 0 && meta.activeIndex !== currentIndex) {
        const nextBlocks = [...currentBlocks];
        const [movedBlock] = nextBlocks.splice(currentIndex, 1);
        const targetIndex = Math.max(0, Math.min(nextBlocks.length, meta.activeIndex));
        nextBlocks.splice(targetIndex, 0, movedBlock);
        composerBlocksRef.current = nextBlocks;
        setComposerBlocks(nextBlocks);
      }
    }

    composerDragMetaRef.current = null;
    composerDragY.stopAnimation();
    composerDragY.setValue(0);
    setDraggingComposerBlockId(null);
    setComposerDragStartIndex(null);
    setComposerDragActiveIndex(null);
  }, [composerDragY]);

  const getComposerDragResponder = useCallback(
    (blockId: string) => {
      const cached = composerDragRespondersRef.current.get(blockId);
      if (cached) return cached;

      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          if (pendingSubmissionRef.current || saveInFlightRef.current) return;
          const currentBlocks = composerBlocksRef.current;
          const startIndex = currentBlocks.findIndex((block) => block.id === blockId);
          if (startIndex < 0) return;

          composerDragMetaRef.current = {
            blockId,
            startIndex,
            activeIndex: startIndex,
          };
          setDraggingComposerBlockId(blockId);
          setComposerDragStartIndex(startIndex);
          setComposerDragActiveIndex(startIndex);
          composerDragY.setValue(0);
        },
        onPanResponderMove: (_event, gestureState) => {
          const meta = composerDragMetaRef.current;
          if (!meta) return;

          const currentBlocks = composerBlocksRef.current;
          const nextIndex = Math.max(
            0,
            Math.min(
              currentBlocks.length - 1,
              Math.round(
                (meta.startIndex * COMPOSER_SORT_ROW_HEIGHT + gestureState.dy) /
                  COMPOSER_SORT_ROW_HEIGHT,
              ),
            ),
          );

          if (nextIndex !== meta.activeIndex) {
            meta.activeIndex = nextIndex;
            setComposerDragActiveIndex(nextIndex);
          }

          const minDy = -meta.startIndex * COMPOSER_SORT_ROW_HEIGHT;
          const maxDy =
            (currentBlocks.length - 1 - meta.startIndex) * COMPOSER_SORT_ROW_HEIGHT;
          const visualDy = Math.max(minDy, Math.min(maxDy, gestureState.dy));
          composerDragY.setValue(visualDy);
        },
        onPanResponderRelease: finishComposerDrag,
        onPanResponderTerminate: finishComposerDrag,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      });

      composerDragRespondersRef.current.set(blockId, responder);
      return responder;
    },
    [composerDragY, finishComposerDrag],
  );

  useEffect(() => {
    if (!sortMode) {
      finishComposerDrag();
      composerDragRespondersRef.current.clear();
    }
  }, [finishComposerDrag, sortMode]);

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

  const buildCurrentDraftRecord = useCallback((): NoteEditorDraftRecord => {
    const currentComposerBlocks = composerBlocksRef.current;
    const currentTextBlocks = currentComposerBlocks
      .filter((block) => block.kind === 'text')
      .map((block) => ({
        id: block.id,
        content: getTextOnlyBlocks(textBlocksByIdRef.current[block.id] ?? []),
      }));
    const currentBlocks = currentTextBlocks.flatMap((block) => block.content);
    const firstMediaBlockId = currentComposerBlocks.find(
      (block) => block.kind === 'image' || block.kind === 'video',
    )?.id;
    const firstShowcaseBlockId = currentComposerBlocks.find(
      (block) => block.kind === 'showcase',
    )?.id;
    const mediaBlocks = currentComposerBlocks.flatMap((block) => {
      const target: 'media' | 'showcase' | null = block.kind === 'showcase'
        ? 'showcase'
        : block.kind === 'image' || block.kind === 'video'
          ? 'media'
          : null;
      if (!target) return [];
      const items = target === 'showcase' ? showcaseItems : mediaItems;
      const fallbackId = target === 'showcase' ? firstShowcaseBlockId : firstMediaBlockId;
      return [{
        id: block.id,
        target,
        objectKeys: items
          .filter((item) => (mediaOwnerByClientIdRef.current[item.clientId] ?? fallbackId) === block.id)
          .map((item) => item.objectKey)
          .filter((key): key is string => Boolean(key)),
      }];
    });
    const contentJson = [
      ...currentBlocks,
      buildNoteComposerBlocksMetadata(
        [FIXED_TITLE_BLOCK, ...currentComposerBlocks],
        currentTextBlocks,
        mediaBlocks,
      ),
    ];
    const sectionMedia = stripEditorMediaDrafts(mergeMedia(mediaItems));
    const sectionShowcase = stripEditorMediaDrafts(mergeMedia(showcaseItems));
    const sectionAudio = stripEditorMediaDrafts(mergeMedia(audioItems));
    const normalizedMediaSections = normalizeNoteMediaSections({
      media: sectionMedia,
      showcase: sectionShowcase,
    });
    const normalizedMedia = normalizeSectionMedia(normalizedMediaSections.media);
    const normalizedShowcase = normalizeSectionMedia(normalizedMediaSections.showcase);
    const normalizedAudio = normalizeSectionMedia(sectionAudio);
    const location = hasLocationDraftValue(locationDraft)
      ? {
          title: locationDraft.title.trim() || null,
          address: locationDraft.address.trim() || null,
          latitude: locationDraft.latitude,
          longitude: locationDraft.longitude,
        }
      : null;
    const sections: Partial<NoteSections> = {
      text: { content: extractPlainText(currentBlocks), contentJson },
      media: { items: normalizedMedia },
      showcase: { items: normalizedShowcase },
      audio: { items: normalizedAudio },
      contacts: { items: contactItems },
      groups: { items: groupCardItems },
      location,
    };
    const uploadedMediaItems = [
      ...mediaItems.filter((item) => item.uploadStatus === 'UPLOADED'),
      ...showcaseItems.filter((item) => item.uploadStatus === 'UPLOADED'),
      ...audioItems.filter((item) => item.uploadStatus === 'UPLOADED'),
    ];
    const uploadedClientIds = new Set(uploadedMediaItems.map((item) => item.clientId));
    return {
      version: 1,
      id: editorDraftId,
      noteId: id ?? null,
      title,
      content: extractPlainText(currentBlocks),
      contentJson,
      sections,
      groupIds: selectedGroupIds,
      mediaKeys: uploadedMediaItems
        .map((item) => item.objectKey)
        .filter((key): key is string => Boolean(key)),
      composerBlocks: currentComposerBlocks,
      textBlocksById: { ...textBlocksByIdRef.current },
      mediaItems: uploadedMediaItems.filter((item) => mediaItems.includes(item)),
      showcaseItems: uploadedMediaItems.filter((item) => showcaseItems.includes(item)),
      audioItems: [...audioItems],
      mediaOwnerByClientId: Object.fromEntries(
        Object.entries(mediaOwnerByClientIdRef.current).filter(([clientId]) => uploadedClientIds.has(clientId)),
      ),
      contactItems,
      groupCardItems,
      location: {
        title: locationDraft.title,
        address: locationDraft.address,
        latitude: locationDraft.latitude,
        longitude: locationDraft.longitude,
      },
      createdAt: Date.parse(createdAtIso) || Date.now(),
      updatedAt: Date.now(),
      pendingSubmission: pendingSubmissionRef.current ?? undefined,
    };
  }, [
    audioItems,
    contactItems,
    createdAtIso,
    editorDraftId,
    groupCardItems,
    id,
    locationDraft,
    mediaItems,
    selectedGroupIds,
    showcaseItems,
    title,
  ]);

  useEffect(() => {
    if (!navigating) return;
    const timer = setTimeout(() => router.back(), 200);
    return () => clearTimeout(timer);
  }, [navigating, router]);

  useEffect(() => {
    editedNoteKeyRef.current = draftRouteKey;
    resetUploadOwnership();
    return invalidateUploadOwnership;
  }, [draftRouteKey, invalidateUploadOwnership, resetUploadOwnership]);

  useEffect(() => {
    const routeGeneration = ++saveGenerationRef.current;
    saveInFlightRef.current = false;
    groupCreateRequestRef.current += 1;
    setGroupCreating(false);
    setGroupCreateOpen(false);
    setGroupCreateName('');
    navigationRequestedRef.current = false;
    draftHydratedRef.current = false;
    setIsSubmitting(false);
    pendingSubmissionRef.current = null;
    setPendingSubmission(null);
    setNavigating(false);
    return () => {
      groupCreateRequestRef.current += 1;
      if (saveGenerationRef.current === routeGeneration) {
        saveGenerationRef.current += 1;
      }
    };
  }, [draftRouteKey]);

  useEffect(() => () => {
    if (recordingAudioRef.current || preparingAudioRef.current) {
      recordingAudioRef.current = false;
      preparingAudioRef.current = false;
      recordingAudioBlockIdRef.current = null;
      void runNoteRecorderWork(async () => {
        try { discardRecordingOutput(await stopNoteRecorder(noteRecorder, true)); } catch { /* Native hook may already be released. */ }
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      });
    }
  }, [discardRecordingOutput, draftRouteKey, noteRecorder]);

  useEffect(() => {
    let cancelled = false;

    fetchNoteGroups()
      .then((groups) => {
        if (!cancelled) setAvailableGroups(groups);
      })
      .catch(() => {
        if (!cancelled) setAvailableGroups([]);
      });

    const resumePending = currentUser?.id && loadLocalNoteDraft(currentUser.id, editorDraftId)?.pendingSubmission;
    if (!isEdit || !id || resumePending) {
      draftHydratedRef.current = false;
      setDraftHydratedKey(null);
      const emptyFingerprint = draftFingerprint(emptyDraftRecord(editorDraftId, id ?? null));
      baselineFingerprintRef.current = emptyFingerprint;
      draftPersistedFingerprintRef.current = emptyFingerprint;
      setSettledRouteKey(null);
      existingSectionsRef.current = null;
      textBlocksByIdRef.current = {};
      textStatsStore.reset();
      setGroupSheetVisible(false);
      setLoadedNoteId(resumePending ? id ?? null : null);
      setTitle('');
      setSelectedGroupIds([]);
      pickerPreviewDisposerRef.current.disposeAll();
      setMediaItems([]);
      setShowcaseItems([]);
      setAudioItems([]);
      mediaOwnerByClientIdRef.current = {};
      setMediaOwnerByClientId({});
      setContactItems([]);
      setGroupCardItems([]);
      setRecordingAudioStartedAt(null);
      recordingAudioRef.current = false;
      recordingAudioBlockIdRef.current = null;
      setComposerBlocks([]);
      composerIdRef.current = 0;
      setTextBlocksById({});
      setSortMode(false);
      setUnrecoverableMediaCount(0);
      setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
      setMapRevealed(false);
      setEditorMounted(true);
      setLoading(false);
      setSettledRouteKey(draftRouteKey);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    draftHydratedRef.current = false;
    setDraftHydratedKey(null);
    baselineFingerprintRef.current = null;
    draftPersistedFingerprintRef.current = null;
    setSettledRouteKey(null);
    setLoadedNoteId(null);
    textStatsStore.reset();
    setGroupSheetVisible(false);
    setTitle('');
    pickerPreviewDisposerRef.current.disposeAll();
    setMediaItems([]);
    setShowcaseItems([]);
    setAudioItems([]);
    mediaOwnerByClientIdRef.current = {};
    setMediaOwnerByClientId({});
    setContactItems([]);
    setGroupCardItems([]);
    setRecordingAudioStartedAt(null);
    recordingAudioRef.current = false;
    recordingAudioBlockIdRef.current = null;
    setComposerBlocks([]);
    composerIdRef.current = 0;
    textBlocksByIdRef.current = {};
    setTextBlocksById({});
    setSortMode(false);
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
        const rawBlocks = note.sections?.text?.contentJson ?? note.contentJson ?? [];
        const savedComposerBlocks = readNoteComposerBlocks(rawBlocks);
        // Once instance metadata exists it is the author's source of truth,
        // including intentional removals. Only legacy notes without a marker
        // should infer blocks from their section fields.
        const normalizedComposerBlocks = (savedComposerBlocks ?? normalizeNoteComposerBlocks(
          null,
          normalizedSections as unknown as Partial<NoteSections>,
          true,
        )).filter((block) => block.kind !== 'title');
        setComposerBlocks(normalizedComposerBlocks);
        composerIdRef.current = normalizedComposerBlocks.length;
        const loaded = stripNoteComposerMetadata(normalizedSections.text.contentJson ?? []);
        const loadedTextBlocks = getTextOnlyBlocks(loaded);
        const legacyText = normalizedSections.text.content;
        // 旧笔记可能只有纯文本，进入编辑时也必须带上，避免保存后清空正文。判据是
        // 「这些块里一个字都没有」而不是「一个块都没有」：contentJson 常常是编辑器
        // 的默认文档 —— 一个空段落 —— 那时块数是 1，按块数判断就会跳过注入，打开
        // 编辑器正文是空的，点完成就用空正文盖掉了服务端的旧 content。
        const textBlocks =
          legacyText && extractPlainText(loadedTextBlocks).trim() === ''
            ? [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: legacyText, styles: {} }],
                },
              ]
            : loadedTextBlocks;

        const savedTextBlocks = readNoteComposerTextBlocks(rawBlocks);
        const textBlockIds = normalizedComposerBlocks
          .filter((block) => block.kind === 'text')
          .map((block) => block.id);
        const nextTextBlocks = Object.fromEntries(
          textBlockIds.map((blockId, index) => [
            blockId,
            savedTextBlocks.find((item) => item.id === blockId)?.content ??
              (index === 0 ? textBlocks : []),
          ]),
        ) as Record<string, Record<string, unknown>[]>;
        textBlocksByIdRef.current = nextTextBlocks;
        setTextBlocksById(nextTextBlocks);
        textStatsStore.setBlocks(Object.values(nextTextBlocks).flat());
        const storedMediaItems = normalizeSectionMedia(normalizedSections.media.items);
        const storedShowcaseItems = normalizeSectionMedia(normalizedSections.showcase.items);
        setMediaItems(storedMediaItems);
        setShowcaseItems(storedShowcaseItems);
        setAudioItems(normalizeSectionMedia((normalizedSections as any).audio?.items));
        const firstMediaBlockId = normalizedComposerBlocks.find(
          (block) => block.kind === 'image' || block.kind === 'video',
        )?.id;
        const firstShowcaseBlockId = normalizedComposerBlocks.find((block) => block.kind === 'showcase')?.id;
        const savedMediaBlocks = readNoteComposerMediaBlocks(rawBlocks);
        const storedOwnerMap = Object.fromEntries([
          ...(firstMediaBlockId
            ? storedMediaItems.map((item) => [item.clientId, firstMediaBlockId] as const)
            : []),
          ...(firstShowcaseBlockId
            ? storedShowcaseItems.map((item) => [item.clientId, firstShowcaseBlockId] as const)
            : []),
        ]);
        savedMediaBlocks.forEach((mediaBlock) => {
          const items = mediaBlock.target === 'showcase' ? storedShowcaseItems : storedMediaItems;
          const keys = new Set(mediaBlock.objectKeys);
          items.forEach((item) => {
            if (keys.has(item.objectKey)) storedOwnerMap[item.clientId] = mediaBlock.id;
          });
        });
        mediaOwnerByClientIdRef.current = storedOwnerMap;
        setMediaOwnerByClientId(storedOwnerMap);
        setContactItems(((normalizedSections as any).contacts?.items ?? []) as NoteCardDraft[]);
        setGroupCardItems(((normalizedSections as any).groups?.items ?? []) as NoteCardDraft[]);
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
        baselineFingerprintRef.current = draftFingerprint({
          version: 1,
          id: editorDraftId,
          noteId: id,
          title: note.title,
          content: note.content ?? extractPlainText(Object.values(nextTextBlocks).flat()),
          contentJson: (rawBlocks ?? []) as Record<string, unknown>[],
          sections: {
            text: {
              content: note.content ?? '',
              contentJson: (rawBlocks ?? []) as Record<string, unknown>[],
            },
            media: { items: storedMediaItems },
            showcase: { items: storedShowcaseItems },
            audio: { items: normalizeSectionMedia((normalizedSections as any).audio?.items) },
            contacts: { items: ((normalizedSections as any).contacts?.items ?? []) as NoteCardDraft[] },
            groups: { items: ((normalizedSections as any).groups?.items ?? []) as NoteCardDraft[] },
            location: buildLocationDraft(note.sections?.location),
          },
          groupIds: note.groups.map((group) => group.id),
          mediaKeys: [
            ...storedMediaItems,
            ...storedShowcaseItems,
            ...normalizeSectionMedia((normalizedSections as any).audio?.items),
          ]
            .map((item) => item.objectKey)
            .filter((key): key is string => Boolean(key)),
          composerBlocks: normalizedComposerBlocks,
          textBlocksById: nextTextBlocks,
          mediaItems: storedMediaItems,
          showcaseItems: storedShowcaseItems,
          audioItems: normalizeSectionMedia((normalizedSections as any).audio?.items),
          mediaOwnerByClientId: storedOwnerMap,
          contactItems: ((normalizedSections as any).contacts?.items ?? []) as NoteCardDraft[],
          groupCardItems: ((normalizedSections as any).groups?.items ?? []) as NoteCardDraft[],
          location: buildLocationDraft(note.sections?.location),
          createdAt: Date.parse(note.createdAt) || Date.now(),
          updatedAt: Date.parse(note.updatedAt) || Date.now(),
        });
        draftPersistedFingerprintRef.current = baselineFingerprintRef.current;
        setLoading(false);
        setEditorMounted(true);
        setSettledRouteKey(draftRouteKey);
      })
      .catch((error) => {
        if (!cancelled) {
          existingSectionsRef.current = null;
          pickerPreviewDisposerRef.current.disposeAll();
          setMediaItems([]);
          setShowcaseItems([]);
          setAudioItems([]);
          mediaOwnerByClientIdRef.current = {};
          setMediaOwnerByClientId({});
          setContactItems([]);
          setGroupCardItems([]);
          setComposerBlocks([]);
          setTextBlocksById({});
          textBlocksByIdRef.current = {};
          setUnrecoverableMediaCount(0);
          setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
          setLoadedNoteId(null);
          baselineFingerprintRef.current = draftFingerprint(emptyDraftRecord(editorDraftId, id));
          draftPersistedFingerprintRef.current = baselineFingerprintRef.current;
          setLoading(false);
          setEditorMounted(true);
          setSettledRouteKey(draftRouteKey);
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
  }, [currentUser?.id, draftRouteKey, editorDraftId, id, isEdit, textStatsStore]);

  useEffect(() => {
    if (!editorMounted || settledRouteKey !== draftRouteKey || draftHydratedKey === draftRouteKey) {
      return;
    }
    if (!currentUser?.id) return;
    let cancelled = false;
    const hydrate = async () => {
      let record = loadLocalNoteDraft(currentUser.id, editorDraftId);
      try {
        // Generated IDs start a new edit; only an explicit resume can exist remotely.
        if (!record?.pendingSubmission && draftMode !== 'new' && !isLocalNoteDraftDeleted(currentUser.id, editorDraftId) && typeof routeDraftId === 'string' && routeDraftId.trim()) {
          const remote = await fetchNoteDraft(editorDraftId);
          const remoteRecord = draftRecordFromServer(remote, editorDraftId);
          if (!record || (!record.pendingSubmission && remoteRecord.updatedAt > record.updatedAt && !record.audioItems.some((item) => item.uploadStatus !== 'UPLOADED'))) {
            record = remoteRecord;
          } else {
            record = refreshLocalNoteDraftMedia(record, remoteRecord);
          }
        }
      } catch {
        // Keep the local snapshot available while offline.
      }
      if (isLocalNoteDraftDeleted(currentUser.id, editorDraftId)) record = null;
      if (record) record = await restoreLocalNoteDraftRecordings(currentUser.id, record);
      const auth = useAuthStore.getState();
      if (cancelled || auth.user?.id !== currentUser.id || auth.sessionEpoch !== sessionEpoch || isLocalNoteDraftDeleted(currentUser.id, editorDraftId)) {
        record?.audioItems.forEach((item) => {
          pickerPreviewDisposerRef.current.retain(item.previewUri);
          pickerPreviewDisposerRef.current.dispose(item.previewUri);
        });
        return;
      }
      if (record) {
        pendingSubmissionRef.current = record.pendingSubmission ?? null;
        setPendingSubmission(record.pendingSubmission ?? null);
        if (record.composerBlocks.length) {
          record = { ...record, composerBlocks: normalizeNoteComposerBlocks(record.composerBlocks, null, false) };
        }
        draftPersistedFingerprintRef.current = draftFingerprint(record);
        setTitle(record.title);
        composerBlocksRef.current = record.composerBlocks;
        setComposerBlocks(record.composerBlocks);
        composerIdRef.current = record.composerBlocks.length;
        textBlocksByIdRef.current = record.textBlocksById;
        setTextBlocksById(record.textBlocksById);
        textStatsStore.setBlocks(Object.values(record.textBlocksById).flat());
        setMediaItems(record.mediaItems);
        setShowcaseItems(record.showcaseItems);
        setAudioItems(record.audioItems);
        record.audioItems.forEach((item) => pickerPreviewDisposerRef.current.retain(item.previewUri));
        mediaOwnerByClientIdRef.current = record.mediaOwnerByClientId;
        setMediaOwnerByClientId(record.mediaOwnerByClientId);
        setContactItems(record.contactItems as NoteCardDraft[]);
        setGroupCardItems(record.groupCardItems as NoteCardDraft[]);
        setSelectedGroupIds(record.groupIds);
        setLocationDraft(record.location);
        setUnrecoverableMediaCount(0);
      }
      if (!record && draftPersistedFingerprintRef.current == null) {
        draftPersistedFingerprintRef.current = baselineFingerprintRef.current;
      }
      draftHydratedRef.current = true;
      setDraftHydratedKey(draftRouteKey);
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [
    currentUser?.id,
    sessionEpoch,
    draftHydratedKey,
    draftRouteKey,
    editorDraftId,
    editorMounted,
    routeDraftId,
    draftMode,
    settledRouteKey,
    textStatsStore,
  ]);

  // Composer/text refs change without changing the builder's identity.
  const currentDraftFingerprint = draftFingerprint(buildCurrentDraftRecord());
  const hasUndurableRecording = audioItems.some((item) => item.uploadStatus !== 'UPLOADED' && item.clientId.startsWith('recording:') && (!item.localRecordingId || !item.previewUri));
  const isDraftDirty = Boolean(
    draftHydratedKey === draftRouteKey &&
      (hasUndurableRecording || (baselineFingerprintRef.current != null &&
      baselineFingerprintRef.current !== currentDraftFingerprint &&
      draftPersistedFingerprintRef.current !== currentDraftFingerprint)),
  );

  const buildCurrentDraftRecordRef = useRef(buildCurrentDraftRecord);
  buildCurrentDraftRecordRef.current = buildCurrentDraftRecord;
  const cleanupRecordingCopies = useCallback(() => {
    removeUnreferencedLocalNoteRecordings(currentUser?.id, audioItems.flatMap((item) => item.localRecordingId ? [item.localRecordingId] : []), editorDraftId);
  }, [audioItems, currentUser?.id, editorDraftId]);

  const persistDraft = useCallback(async (flush = false): Promise<boolean> => {
    const auth = useAuthStore.getState();
    if (!currentUser?.id || auth.user?.id !== currentUser.id || auth.sessionEpoch !== sessionEpoch ||
      !draftHydratedRef.current || navigationRequestedRef.current || draftRouteKeyRef.current !== draftRouteKey || isLocalNoteDraftDeleted(currentUser.id, editorDraftId)) { draftRemoteQueue.cancel(); return false; }
    let record = buildCurrentDraftRecord();
    if (record.pendingSubmission) {
      // The server may already have consumed this draft. Keep the recovery
      // snapshot locally; never overwrite it with a subsequent draft PUT.
      try { saveLocalNoteDraft(currentUser.id, record); return true; } catch { return false; }
    }
    const initialFingerprint = draftFingerprint(record);
    if (!hasUndurableRecording && baselineFingerprintRef.current === initialFingerprint && draftPersistedFingerprintRef.current === initialFingerprint) return true;
    const writeVersion = ++draftWriteVersionRef.current;
    const isCurrentSession = () => {
      const state = useAuthStore.getState();
      return state.user?.id === currentUser.id && state.sessionEpoch === sessionEpoch && draftRouteKeyRef.current === draftRouteKey && !isLocalNoteDraftDeleted(currentUser.id, editorDraftId);
    };
    const markPersisted = (recordFingerprint: string) => {
      if (isCurrentSession() && writeVersion >= successfulDraftWriteVersionRef.current) {
        successfulDraftWriteVersionRef.current = writeVersion;
        draftPersistedFingerprintRef.current = recordFingerprint;
        setDraftPersistenceVersion((version) => version + 1);
      }
    };
    const prepareAndSaveLocal = async () => {
      if (!isCurrentSession() || navigationRequestedRef.current) return false;
      const restored = new Map<string, EditorNoteMediaDraft>();
      for (const item of record.audioItems) {
        if (item.uploadStatus === 'UPLOADED' || !item.clientId.startsWith('recording:') || item.localRecordingId || !item.previewUri) continue;
        try {
          const stored = await persistNoteRecording(currentUser.id, item.previewUri);
          restored.set(item.clientId, { ...item, localRecordingId: stored.localRecordingId, previewUri: stored.uri });
        } catch { /* A failed upload can only be saved after its recording is durable. */ }
      }
      const latest = buildCurrentDraftRecordRef.current();
      const retained = new Set(latest.audioItems.map((item) => item.clientId));
      for (const [clientId, item] of restored) {
        if (!isCurrentSession() || navigationRequestedRef.current || !retained.has(clientId)) {
          if (isLocalNoteDraftDeleted(currentUser.id, editorDraftId)) {
            try { retainDeletedNoteDraftRecording(currentUser.id, editorDraftId, item.localRecordingId!); }
            catch (error) { reportHandledFailure('noteEditor', 'draftDeleteCleanup', error); }
          }
          removeUnreferencedLocalNoteRecordings(currentUser.id, [item.localRecordingId!]);
          restored.delete(clientId);
        }
      }
      if (!isCurrentSession() || navigationRequestedRef.current) return false;
      record = { ...latest, audioItems: latest.audioItems.map((item) => {
        const stored = restored.get(item.clientId);
        return stored ? { ...item, localRecordingId: stored.localRecordingId, previewUri: stored.previewUri } : item;
      }) };
      if (restored.size) setAudioItems(record.audioItems);
      const recordFingerprint = draftFingerprint(record);
      if (writeVersion < successfulDraftWriteVersionRef.current) return draftPersistedFingerprintRef.current === recordFingerprint;
      try {
        saveLocalNoteDraft(currentUser.id, record);
        markPersisted(recordFingerprint);
        return true;
      } catch { return false; }
    };
    // Local snapshots remain fast; remote writes keep only the latest queued
    // snapshot. Deferred copies are fenced by account and route.
    const localSaved = await prepareAndSaveLocal();
    if (!isCurrentSession() || navigationRequestedRef.current || record.pendingSubmission) return localSaved;
    const pending = draftRemoteQueue.schedule(async () => {
      if (!isCurrentSession() || navigationRequestedRef.current || pendingSubmissionRef.current) return false;
      const hasLocalRecording = record.audioItems.some((item) => item.uploadStatus !== 'UPLOADED');
      try {
        await saveNoteDraft(editorDraftId, localDraftSummaryToServerInput(record));
        if (!isCurrentSession()) return false;
        if (!hasLocalRecording) markPersisted(draftFingerprint(record));
        return !hasLocalRecording;
      } catch {
        return false;
      }
    });
    const outcome = pending.then((remoteSaved) => localSaved || remoteSaved);
    draftSavePromiseRef.current = outcome;
    if (flush) await draftRemoteQueue.flush();
    return outcome;
  }, [buildCurrentDraftRecord, currentUser?.id, sessionEpoch, editorDraftId, draftRouteKey, draftRemoteQueue, hasUndurableRecording]);
  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;

  useEffect(() => {
    const revertedPersistedDraft = baselineFingerprintRef.current === currentDraftFingerprint && draftPersistedFingerprintRef.current !== currentDraftFingerprint;
    if (!draftHydratedRef.current || draftHydratedKey !== draftRouteKey || (!isDraftDirty && !revertedPersistedDraft)) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      void persistDraft();
    }, 650);
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [currentDraftFingerprint, draftHydratedKey, draftRouteKey, isDraftDirty, persistDraft]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        void persistDraftRef.current(true);
      }
    });
    return () => {
      subscription.remove();
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      if (draftTextSaveTimerRef.current) clearTimeout(draftTextSaveTimerRef.current);
      void persistDraftRef.current(true);
    };
  }, []);

  const completeNavigation = useCallback(
    (action?: NavigationAction, force = false) => {
      if (navigationRequestedRef.current && !force) return;
      navigationRequestedRef.current = true;
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      invalidateUploadOwnership();
      setEditorMounted(false);
      if (action) {
        setTimeout(() => navigation.dispatch(action), 0);
      } else {
        setNavigating(true);
      }
    },
    [invalidateUploadOwnership, navigation],
  );

  const promptDraftExit = useCallback(
    (action?: NavigationAction) => {
      const isCurrentEditor = () => {
        const auth = useAuthStore.getState();
        return auth.user?.id === currentUser?.id && auth.sessionEpoch === sessionEpoch && draftRouteKeyRef.current === draftRouteKey;
      };
      if (isLocalNoteDraftDeleted(currentUser?.id, editorDraftId)) { draftRemoteQueue.cancel(); completeNavigation(action); return; }
      if (recordingAudioRef.current || uploadInFlightRef.current || saveInFlightRef.current) {
        Alert.alert(
          t('notes.edit.waitForMediaTitle', { defaultValue: '请先完成当前操作' }),
          t('notes.edit.waitForMediaMessage', { defaultValue: '请先结束录音或等待上传、保存完成，再返回。' }),
        );
        return;
      }
      const saveAndExit = () => {
        saveInFlightRef.current = true;
        setIsSubmitting(true);
        setTextBlocksById({ ...textBlocksByIdRef.current });
        void persistDraft(true).then((saved) => {
          if (!isCurrentEditor()) return;
          if (saved) completeNavigation(action);
          else {
            saveInFlightRef.current = false;
            setIsSubmitting(false);
            Alert.alert(t('common.errorOccurred'), t('notes.drafts.saveFailed'));
          }
        });
      };
      if (pendingSubmissionRef.current) {
        saveAndExit();
        return;
      }
      const currentFingerprint = draftFingerprint(buildCurrentDraftRecord());
      const dirtyNow = hasUndurableRecording || (
        draftHydratedRef.current &&
        baselineFingerprintRef.current != null &&
        draftPersistedFingerprintRef.current !== currentFingerprint);
      if (!dirtyNow) {
        if (currentUser?.id) saveAndExit();
        else completeNavigation(action);
        return;
      }
      Alert.alert(
        t('notes.drafts.unsavedTitle', { defaultValue: '保存未完成的笔记？' }),
        t('notes.drafts.unsavedMessage', {
          defaultValue: '未保存的内容会放入草稿箱，之后可以继续编辑。',
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('notes.drafts.discard', { defaultValue: '直接退出' }),
            style: 'destructive',
            onPress: () => {
              if (!isCurrentEditor()) return;
              if (currentUser?.id) {
                try { if (!stageLocalNoteDraftDeletion(currentUser.id, editorDraftId, buildCurrentDraftRecord().audioItems.flatMap((item) => item.localRecordingId ? [item.localRecordingId] : []))) return; }
                catch { Alert.alert(t('common.errorOccurred'), t('notes.drafts.deleteFailed')); return; }
              } else removeLocalNoteDraft(currentUser?.id, editorDraftId);
              draftRemoteQueue.cancel();
              completeNavigation(action);
              // Delete after in-flight saves, so their late response cannot revive a discarded draft.
              void draftSavePromiseRef.current.catch(() => false).then(async () => {
                if (!isCurrentEditor() || !currentUser?.id) return;
                try {
                  const cleanedRecordings = await finishLocalNoteDraftDeletion(currentUser.id, editorDraftId);
                  if (!isCurrentEditor()) return;
                  await deleteNoteDraft(editorDraftId);
                  if (isCurrentEditor()) confirmNoteDraftDeletion(currentUser.id, editorDraftId, cleanedRecordings);
                } catch { /* DraftsScreen retains and retries both cleanup and server deletion. */ }
              });
            },
          },
          {
            text: t('notes.drafts.save', { defaultValue: '保存到草稿箱' }),
            onPress: () => {
              if (!isCurrentEditor()) return;
              saveAndExit();
            },
          },
        ],
      );
    },
    [
      completeNavigation,
      currentUser?.id,
      sessionEpoch,
      draftRouteKey,
      buildCurrentDraftRecord,
      editorDraftId,
      draftRemoteQueue,
      persistDraft,
      hasUndurableRecording,
      t,
    ],
  );

  // Keep the guard enabled for the lifetime of the editor. Text blocks live in
  // refs to avoid re-rendering the whole note while typing, so the callback
  // computes the latest fingerprint when navigation is actually attempted.
  usePreventRemove(editorMounted && !navigationRequestedRef.current, ({ data }) => {
    promptDraftExit(data.action);
  });

  useFocusEffect(
    useCallback(() => {
      resetUploadOwnership();
      if (isLocalNoteDraftDeleted(currentUser?.id, editorDraftId)) {
        draftRemoteQueue.cancel();
        completeNavigation(undefined, true);
        return invalidateUploadOwnership;
      }
      const picked = consumePickedLocation();
      if (picked && !pendingSubmissionRef.current && !saveInFlightRef.current) {
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
    }, [completeNavigation, currentUser?.id, draftRemoteQueue, editorDraftId, consumePickedLocation, invalidateUploadOwnership, resetUploadOwnership]),
  );

  const handleContentChange = useCallback((blockId: string, newBlocks: Record<string, unknown>[]) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    const nextBlocks = getTextOnlyBlocks(newBlocks);
    textBlocksByIdRef.current = {
      ...textBlocksByIdRef.current,
      [blockId]: nextBlocks,
    };
    textStatsStore.setBlocks(Object.values(textBlocksByIdRef.current).flat());
    if (draftTextSaveTimerRef.current) clearTimeout(draftTextSaveTimerRef.current);
    draftTextSaveTimerRef.current = setTimeout(() => {
      draftTextSaveTimerRef.current = null;
      void persistDraftRef.current();
    }, 180);
  }, [textStatsStore]);

  const handleAddSectionMedia = useCallback(
    async ({
      target,
      kind,
      blockId,
    }: {
      target: SectionMediaTarget;
      kind: SectionUploadKind;
      blockId?: string;
    }) => {
      if (pendingSubmissionRef.current || saveInFlightRef.current || !isRouteDataReady || uploadInFlightRef.current) return;
      uploadInFlightRef.current = true;
      const operationToken = uploadOperationGuardRef.current.begin();
      // 结果能否落库只认这一条：批次开始时编辑的是哪一篇笔记。
      const batchNoteKey = editedNoteKeyRef.current;
      let batchDraftIds: Set<string> = new Set();
      const stillEditingSameNote = () => editedNoteKeyRef.current === batchNoteKey;
      const blockIsMounted = () =>
        !blockId || composerBlocksRef.current.some((block) => block.id === blockId);
      const uploadKey: UploadingSection = `${target}:${kind}`;
      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!uploadOperationGuardRef.current.isActive(operationToken)) return;
        if (!permission.granted) return;

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: kind === 'media'
            ? ['images', 'videos']
            : kind === 'video'
              ? ['videos']
              : ['images'],
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
        const acceptedAssets = selectedAssets.filter((asset) => {
          const isVideo = kind === 'video' || (kind === 'media' && asset.type === 'video');
          return !isVideo || !getNoteVideoUploadPolicyViolation({
            fileSize: asset.fileSize,
            duration: asset.duration,
          });
        });
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

        // A picker can stay open while the author removes its section. Do not
        // upload or reintroduce files for a block that no longer exists.
        if (!blockIsMounted()) {
          pickerPreviewDisposerRef.current.disposeAssets(acceptedAssets);
          return;
        }

        // 「上传中…」直到这里才亮。此前是进函数就亮，而系统相册可以开着好几分钟：
        // 网页端对话框背后的页面仍然可见，作者一个文件都还没选，两个按钮就已经
        // 变成上传中并且全部禁用了。重入由 uploadInFlightRef 挡住，与这个标签无关。
        setUploadingSection(uploadKey);
        const pendingDrafts: EditorNoteMediaDraft[] = createPendingNoteMediaDrafts(
          acceptedAssets,
          'IMAGE',
        ).map((draft, index): EditorNoteMediaDraft => ({
          ...draft,
          type: kind === 'video' || (kind === 'media' && acceptedAssets[index]?.type === 'video')
            ? 'VIDEO' as const
            : 'IMAGE' as const,
        }));
        batchDraftIds = new Set(pendingDrafts.map((item) => item.clientId));
        if (blockId && pendingDrafts.length) {
          const nextOwners = { ...mediaOwnerByClientIdRef.current };
          pendingDrafts.forEach((item) => {
            nextOwners[item.clientId] = blockId;
          });
          mediaOwnerByClientIdRef.current = nextOwners;
          setMediaOwnerByClientId(nextOwners);
        }
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
          const isVideo = kind === 'video' || (kind === 'media' && asset.type === 'video');
          const fallbackName = isVideo ? 'video.mp4' : 'image.jpg';
          const fallbackType = isVideo ? 'video/mp4' : 'image/jpeg';
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
            isVideo ? VIDEO_UPLOAD_TIMEOUT_MS : undefined,
          );
          // notes/ 是私有目录：直连地址一律 403，读取由服务端按 objectKey 现签。
          // 所以这里只上送 key，落库地址交给服务端派生 —— 不传 url，也不造假地址。
          return {
            clientId,
            type: isVideo ? 'VIDEO' : 'IMAGE',
            objectKey: presign.key,
            width: asset.width ?? undefined,
            height: asset.height ?? undefined,
            mimeType: contentType,
            size: asset.fileSize ?? undefined,
            durationMs:
              isVideo && typeof asset.duration === 'number'
                ? Math.round(asset.duration)
                : undefined,
            sortOrder: 0,
          };
        },
        );
        // 结果先落库，再谈 UI。此前这里先查「本次操作是否仍持有所有权」，失焦就
        // 直接 return —— 于是**已经传完**的对象被整批丢掉：字节已经躺在对象存储里，
        // 丢掉的是用户刚等完的那几十秒和一份已经付过的流量。所有权只管弹窗和按钮态。
        if (stillEditingSameNote() && blockIsMounted()) {
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
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
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
    if (mediaOwnerByClientIdRef.current[clientId]) {
      const nextOwners = { ...mediaOwnerByClientIdRef.current };
      delete nextOwners[clientId];
      mediaOwnerByClientIdRef.current = nextOwners;
      setMediaOwnerByClientId(nextOwners);
    }
  }, []);

  const handleAddAudioFile = useCallback(async (blockId?: string) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current || !isRouteDataReady || uploadInFlightRef.current || recordingAudioRef.current) return;
    uploadInFlightRef.current = true;
    const operationToken = uploadOperationGuardRef.current.begin();
    const batchNoteKey = editedNoteKeyRef.current;
    let batchDraftIds: Set<string> = new Set();
    const blockIsMounted = () =>
      !blockId || composerBlocksRef.current.some((block) => block.id === blockId);
    const stillEditingSameNote = () => editedNoteKeyRef.current === batchNoteKey;

    try {
      // DocumentPicker is a native module. Load it only when the user asks to
      // upload audio so an older dev client without the module can still open
      // the notes screen and show a normal product message.
      const result = await (async () => {
        try {
          const documentPicker = await import('expo-document-picker');
          return await documentPicker.getDocumentAsync({
            type: 'audio/*',
            multiple: true,
            copyToCacheDirectory: true,
          });
        } catch (error) {
          reportHandledFailure('noteEditor', 'audioPickerUnavailable', error);
          if (uploadOperationGuardRef.current.isActive(operationToken)) {
            Alert.alert(
              t('notes.edit.audioPickerUnavailableTitle', {
                defaultValue: '暂时无法选择音频',
              }),
              t('notes.edit.audioPickerUnavailableMessage', {
                defaultValue: '当前版本暂不支持选择音频，请更新应用后重试。',
              }),
            );
          }
          return null;
        }
      })();
      if (!result) return;
      if (!uploadOperationGuardRef.current.isActive(operationToken)) {
        if (!result.canceled && result.assets) {
          pickerPreviewDisposerRef.current.retainAssets(result.assets);
          pickerPreviewDisposerRef.current.disposeAssets(result.assets);
        }
        return;
      }
      if (result.canceled || !result.assets?.length) return;

      pickerPreviewDisposerRef.current.retainAssets(result.assets);
      const { selectedAssets, overflowAssets } = splitPickerAssets(result.assets);
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
      if (!blockIsMounted()) {
        pickerPreviewDisposerRef.current.disposeAssets(selectedAssets);
        return;
      }

      if (selectedAssets.some((asset) => !resolveUploadContentType({ mimeType: asset.mimeType, fileName: asset.name || asset.uri.split('/').pop() }))) {
        pickerPreviewDisposerRef.current.disposeAssets(selectedAssets);
        Alert.alert(t('notes.editor.mediaUploadFailedTitle'), t('notes.edit.unsupportedAudio'));
        return;
      }

      setUploadingSection('audio');
      const pendingDrafts = createPendingNoteMediaDrafts(
        selectedAssets.map((asset) => ({
          uri: asset.uri,
          fileSize: asset.size,
        })),
        'AUDIO',
      );
      batchDraftIds = new Set(pendingDrafts.map((item) => item.clientId));
      if (pendingDrafts.length) {
        setAudioItems((current) => [
          ...current,
          ...pendingDrafts.map((item, index) => ({
            ...item,
            sortOrder: current.length + index,
          })),
        ]);
      }

      const batch = await uploadNoteMediaBatch(
        selectedAssets.map((asset, index) => ({ asset, clientId: pendingDrafts[index].clientId })),
        async ({ asset, clientId }) => {
          const filename = asset.name || asset.uri.split('/').pop() || 'note-audio.m4a';
          const contentType =
            resolveUploadContentType({ mimeType: asset.mimeType, fileName: filename })!;
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
          );
          return {
            clientId,
            type: 'AUDIO' as CreateNoteMediaInput['type'],
            objectKey: presign.key,
            mimeType: contentType,
            size: asset.size ?? undefined,
            sortOrder: 0,
          };
        },
      );

      if (stillEditingSameNote() && blockIsMounted()) {
        batch.failedIndexes.forEach((index) =>
          pickerPreviewDisposerRef.current.dispose(selectedAssets[index]?.uri),
        );
        setAudioItems((current) => reconcileNoteMediaDrafts(current, batch.items, batchDraftIds));
      }
      if (!uploadOperationGuardRef.current.isActive(operationToken)) return;
      if (batch.failedCount) {
        const { error, errorNames } = summarizeNoteMediaBatchFailure(batch.errors);
        reportHandledFailure('noteEditor', 'audioFileUploadBatch', error, {
          failed: batch.failedCount,
          total: selectedAssets.length,
          reason: 'audio.file',
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
      if (stillEditingSameNote()) {
        setAudioItems((current) => {
          const { kept, discarded } = partitionUnsettledDrafts(current, batchDraftIds);
          discarded.forEach((item) => pickerPreviewDisposerRef.current.dispose(item.previewUri));
          return kept.map((item, index) => ({ ...item, sortOrder: index }));
        });
      }
      reportHandledFailure('noteEditor', 'audioFileUpload', error);
      if (uploadOperationGuardRef.current.isActive(operationToken)) {
        Alert.alert(
          t('notes.editor.mediaUploadFailedTitle', { defaultValue: '上传失败' }),
          t('notes.editor.mediaUploadFailedMessage', { defaultValue: '请稍后重试' }),
        );
      }
    } finally {
      if (uploadOperationGuardRef.current.complete(operationToken)) {
        uploadInFlightRef.current = false;
        setUploadingSection(null);
      }
    }
  }, [isRouteDataReady, t]);

  const uploadRecordedAudio = useCallback(async (item: EditorNoteMediaDraft, noteKey: string) => {
    const localUri = item.previewUri;
    if (!localUri) return;
    try {
      const filename = Platform.OS === 'web' ? 'note-audio.webm' : localUri.split('/').pop() || 'note-audio.m4a';
      const contentType = item.mimeType ?? (Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4');
      const presign = await requestUploadPresign({
        filename: sanitizeUploadFilename(filename), contentType, folder: 'notes', fileUri: localUri,
      });
      await uploadLocalFileToPresignedUrl(presign.uploadUrl, contentType, localUri, presign.requiredHeaders);
      if (editedNoteKeyRef.current === noteKey) {
        setAudioItems((current) => current.map((audio) => audio.clientId === item.clientId
          ? { ...audio, objectKey: presign.key, mimeType: contentType, uploadStatus: 'UPLOADED' }
          : audio));
      }
    } catch (error) {
      // The local PENDING item stays playable in Preview and can be retried.
      // Do not allow another recording to replace the recorder's cached file.
      reportHandledFailure('noteEditor', 'audioUpload', error);
      if (editedNoteKeyRef.current === noteKey) {
        Alert.alert(t('notes.edit.mediaUploadFailedTitle', { defaultValue: '上传失败' }),
          t('notes.edit.mediaUploadFailedMessage', { defaultValue: '录音上传失败，请稍后重试' }));
      }
    }
  }, [t]);

  const retryRecordedAudio = useCallback(async (item: EditorNoteMediaDraft) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current || !isRouteDataReady || uploadInFlightRef.current || recordingAudioRef.current) return;
    uploadInFlightRef.current = true;
    const token = uploadOperationGuardRef.current.begin();
    setUploadingSection('audio');
    try {
      await uploadRecordedAudio(item, editedNoteKeyRef.current);
    } finally {
      if (uploadOperationGuardRef.current.complete(token)) {
        uploadInFlightRef.current = false;
        setUploadingSection(null);
      }
    }
  }, [isRouteDataReady, uploadRecordedAudio]);

  const stopNoteRecording = useCallback(async () => {
    if (!recordingAudioRef.current || uploadInFlightRef.current) return;
    const noteKey = editedNoteKeyRef.current;
    const blockId = recordingAudioBlockIdRef.current;
    uploadInFlightRef.current = true;
    const token = uploadOperationGuardRef.current.begin();
    const ownerId = currentUser?.id;
    const isCurrentStop = () => uploadOperationGuardRef.current.isActive(token) && editedNoteKeyRef.current === noteKey &&
      (!blockId || composerBlocksRef.current.some((block) => block.id === blockId));
    recordingAudioRef.current = false;
    recordingAudioBlockIdRef.current = null;
    setRecordingAudioStartedAt(null);
    setUploadingSection('audio');
    try {
      const { elapsedMs, localUri } = await runNoteRecorderWork(async () => {
        const status = noteRecorder.getStatus();
        const elapsedMs = status.durationMillis || (recordingAudioStartedAt ? Date.now() - recordingAudioStartedAt : 0);
        try {
          return { elapsedMs, localUri: await stopNoteRecorder(noteRecorder) };
        } finally {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        }
      });
      if (!isCurrentStop()) { discardRecordingOutput(localUri); return; }
      if (!localUri) throw new Error('录音文件生成失败');
      const filename = Platform.OS === 'web' ? 'note-audio.webm' : localUri.split('/').pop() || 'note-audio.m4a';
      let item: EditorNoteMediaDraft = {
        type: 'AUDIO', objectKey: '', previewUri: localUri,
        clientId: `recording:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        mimeType: Platform.OS === 'web' ? 'audio/webm' : resolveUploadContentType({ fileName: filename }) ?? 'audio/mp4',
        durationMs: Math.max(1, Math.round(elapsedMs)), uploadStatus: 'PENDING', sortOrder: 0,
      };
      pickerPreviewDisposerRef.current.retain(localUri);
      if (ownerId) {
        try {
          const stored = await persistNoteRecording(ownerId, localUri);
          item = { ...item, localRecordingId: stored.localRecordingId, previewUri: stored.uri };
        } catch {
          // Keep the cache recording playable. Saving cannot succeed until a
          // later durable copy or the upload succeeds.
          reportHandledFailure('noteEditor', 'audioLocalStorage', new Error('Recording storage failed'));
        }
      }
      if (!isCurrentStop()) {
        if (ownerId && item.localRecordingId) removeUnreferencedLocalNoteRecordings(ownerId, [item.localRecordingId]);
        pickerPreviewDisposerRef.current.dispose(localUri);
        return;
      }
      setAudioItems((current) => [...current, { ...item, sortOrder: current.length }]);
      await uploadRecordedAudio(item, noteKey);
    } catch (error) {
      reportHandledFailure('noteEditor', 'audioRecordStop', error);
      if (editedNoteKeyRef.current === noteKey) {
        Alert.alert(t('notes.edit.mediaUploadFailedTitle', { defaultValue: '上传失败' }),
          t('notes.edit.mediaUploadFailedMessage', { defaultValue: '录音保存失败，请稍后重试' }));
      }
    } finally {
      if (uploadOperationGuardRef.current.complete(token)) {
        uploadInFlightRef.current = false;
        setUploadingSection(null);
      }
    }
  }, [currentUser?.id, discardRecordingOutput, noteRecorder, recordingAudioStartedAt, t, uploadRecordedAudio]);

  const toggleNoteRecording = useCallback(async (blockId?: string) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current || !isRouteDataReady || uploadingSection !== null || uploadInFlightRef.current) return;
    if (recordingAudioRef.current) {
      await stopNoteRecording();
      return;
    }
    if (audioItems.some((item) => item.uploadStatus !== 'UPLOADED')) return;
    uploadInFlightRef.current = true;
    const operationToken = uploadOperationGuardRef.current.begin();
    const noteKey = editedNoteKeyRef.current;
    const isCurrentRecording = () => {
      const auth = useAuthStore.getState();
      return uploadOperationGuardRef.current.isActive(operationToken) && editedNoteKeyRef.current === noteKey &&
        (!blockId || composerBlocksRef.current.some((block) => block.id === blockId)) &&
        (auth.user?.id ?? null) === (currentUser?.id ?? null) && auth.sessionEpoch === sessionEpoch;
    };
    setUploadingSection('audio');
    preparingAudioRef.current = true;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!isCurrentRecording()) return;
      if (!permission.granted) {
        Alert.alert(t('permissions.insufficientTitle'), t('permissions.microphone'));
        return;
      }
      await runNoteRecorderWork(async () => {
        if (!isCurrentRecording()) return;
        let prepared = false;
        let started = false;
        try {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          if (!isCurrentRecording()) return;
          // Every attempt gets a fresh output file; previous local previews stay intact.
          await noteRecorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
          prepared = true;
          if (!isCurrentRecording()) return;
          noteRecorder.record();
          started = true;
          recordingAudioRef.current = true;
          recordingAudioBlockIdRef.current = blockId ?? composerBlocksRef.current.find((block) => block.kind === 'audio')?.id ?? null;
          setRecordingAudioStartedAt(Date.now());
        } finally {
          // Run before any later queued start, so stale A cannot stop B.
          if (!started) {
            if (prepared && Platform.OS === 'web') {
              try { discardRecordingOutput(await stopNoteRecorder(noteRecorder, true)); } catch { /* Recorder may already be released. */ }
            }
            await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
          }
        }
      });
    } catch (error) {
      reportHandledFailure('noteEditor', 'audioRecordStart', error);
      if (!isCurrentRecording()) return;
      Alert.alert(
        t('notes.edit.mediaUploadFailedTitle', { defaultValue: '录音失败' }),
        t('notes.edit.mediaUploadFailedMessage', { defaultValue: '无法开始录音，请稍后重试' }),
      );
    } finally {
      if (uploadOperationGuardRef.current.complete(operationToken)) {
        preparingAudioRef.current = false;
        uploadInFlightRef.current = false;
        setUploadingSection(null);
      }
    }
  }, [currentUser?.id, sessionEpoch, audioItems, discardRecordingOutput, isRouteDataReady, noteRecorder, stopNoteRecording, t, uploadingSection]);


  const openCardPicker = useCallback(async (kind: CardPickerKind) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current || !isRouteDataReady || recordingAudioRef.current) return;
    const requestId = ++cardPickerRequestRef.current;
    const accountId = currentUser?.id ?? null;
    cardPickerSessionRef.current = { userId: accountId, epoch: sessionEpoch };
    const isCurrentRequest = () => {
      const auth = useAuthStore.getState();
      return cardPickerRequestRef.current === requestId && auth.user?.id === accountId && auth.sessionEpoch === sessionEpoch;
    };
    setCardPickerKind(kind);
    setCardPickerSearch('');
    const current = kind === 'contact' ? contactItems : groupCardItems;
    setSelectedCardIds(current.map((item) => item.id));
    const cachedFriends = kind === 'contact'
      ? getCachedNotePickerFriends(accountId)
      : null;
    const cachedCircles = kind === 'group'
      ? getCachedNotePickerCircles(accountId)
      : null;
    const hasCached = kind === 'contact'
      ? cachedFriends !== null
      : cachedCircles !== null;
    setFriends(cachedFriends ?? []);
    setCircles(cachedCircles ?? []);

    const isFresh = kind === 'contact'
      ? isNotePickerFriendsFresh(accountId)
      : isNotePickerCirclesFresh(accountId);
    // Cached data is usable immediately. A stale cache refreshes in the
    // background without blocking the picker or showing a spinner.
    setCardPickerLoading(!hasCached);
    if (hasCached && isFresh) return;

    try {
      if (kind === 'contact') {
        const nextFriends = await loadNotePickerFriends(accountId);
        if (isCurrentRequest()) setFriends(nextFriends);
      } else {
        const nextCircles = await loadNotePickerCircles(accountId);
        if (isCurrentRequest()) setCircles(nextCircles);
      }
    } catch (error) {
      reportHandledFailure('noteEditor', 'cardPickerLoad', error);
      if (!hasCached && isCurrentRequest()) {
        Alert.alert(
          t('notes.edit.cardPickerLoadFailedTitle', { defaultValue: '加载失败' }),
          t('notes.edit.cardPickerLoadFailedMessage', { defaultValue: '名片列表加载失败，请稍后重试' }),
        );
        setCardPickerKind(null);
        setCardPickerSearch('');
      }
    } finally {
      if (isCurrentRequest()) setCardPickerLoading(false);
    }
  }, [
    contactItems,
    currentUser?.id,
    sessionEpoch,
    groupCardItems,
    isRouteDataReady,
    t,
  ]);

  const closeCardPicker = useCallback(() => {
    cardPickerRequestRef.current += 1;
    setCardPickerKind(null);
    setCardPickerSearch('');
  }, []);

  const confirmCardPicker = useCallback(() => {
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    const auth = useAuthStore.getState();
    const pickerSession = cardPickerSessionRef.current;
    if (!cardPickerKind || !pickerSession || auth.user?.id !== pickerSession.userId || auth.sessionEpoch !== pickerSession.epoch) return;
    if (cardPickerKind === 'contact') {
      setContactItems([
        ...contactItems.filter((item) => selectedCardIds.includes(item.id) && !contactPickerItems.some((option) => option.id === item.id)),
        ...contactPickerItems.filter((item) => selectedCardIds.includes(item.id)).map((item) => ({
          id: item.id,
          name: item.name,
          faceURL: item.avatarUrl,
        })),
      ]);
    } else {
      setGroupCardItems([
        ...groupCardItems.filter((item) => selectedCardIds.includes(item.id) && !circles.some((option) => option.id === item.id)),
        ...circles.filter((circle) => selectedCardIds.includes(circle.id)).map((circle) => ({
          id: circle.id,
          name: circle.name,
          faceURL: circle.avatarUrl,
        })),
      ]);
    }
    closeCardPicker();
  }, [cardPickerKind, circles, contactPickerItems, contactItems, groupCardItems, closeCardPicker, selectedCardIds]);

  const handleOpenLocationPicker = useCallback(() => {
    if (pendingSubmissionRef.current || saveInFlightRef.current || !isRouteDataReady || uploadInFlightRef.current) return;
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
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
    // 清掉位置也把地图收回去：下一个位置要重新征得同意。
    setMapRevealed(false);
  }, []);

  const handleRemoveComposerBlock = useCallback((block: NoteComposerBlock) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    const currentBlocks = composerBlocksRef.current;
    const remainingBlocks = currentBlocks.filter((item) => item.id !== block.id);
    composerBlocksRef.current = remainingBlocks;
    setComposerBlocks(remainingBlocks);

    if (block.kind === 'title') {
      setTitle('');
    } else if (block.kind === 'text') {
      delete textBlocksByIdRef.current[block.id];
      const nextTextBlocks = { ...textBlocksByIdRef.current };
      textBlocksByIdRef.current = nextTextBlocks;
      setTextBlocksById(nextTextBlocks);
      textStatsStore.setBlocks(Object.values(nextTextBlocks).flat());
    } else if (block.kind === 'image' || block.kind === 'video') {
      const fallbackBlockId = currentBlocks.find(
        (item) => item.kind === 'image' || item.kind === 'video',
      )?.id;
      const removedClientIds = new Set(
        mediaItems
          .filter((item) => (mediaOwnerByClientIdRef.current[item.clientId] ?? fallbackBlockId) === block.id)
          .map((item) => item.clientId),
      );
      setMediaItems((current) => current
        .filter((item) => {
          if (!removedClientIds.has(item.clientId)) return true;
          pickerPreviewDisposerRef.current.dispose(item.previewUri);
          return false;
        })
        .map((item, index) => ({ ...item, sortOrder: index })));
      const nextOwners = { ...mediaOwnerByClientIdRef.current };
      removedClientIds.forEach((clientId) => delete nextOwners[clientId]);
      mediaOwnerByClientIdRef.current = nextOwners;
      setMediaOwnerByClientId(nextOwners);
      if (fallbackBlockId === block.id) setUnrecoverableMediaCount(0);
    } else if (block.kind === 'showcase') {
      const fallbackBlockId = currentBlocks.find((item) => item.kind === 'showcase')?.id;
      const removedClientIds = new Set(
        showcaseItems
          .filter((item) => (mediaOwnerByClientIdRef.current[item.clientId] ?? fallbackBlockId) === block.id)
          .map((item) => item.clientId),
      );
      setShowcaseItems((current) => current
        .filter((item) => {
          if (!removedClientIds.has(item.clientId)) return true;
          pickerPreviewDisposerRef.current.dispose(item.previewUri);
          return false;
        })
        .map((item, index) => ({ ...item, sortOrder: index })));
      const nextOwners = { ...mediaOwnerByClientIdRef.current };
      removedClientIds.forEach((clientId) => delete nextOwners[clientId]);
      mediaOwnerByClientIdRef.current = nextOwners;
      setMediaOwnerByClientId(nextOwners);
      if (fallbackBlockId === block.id) setUnrecoverableMediaCount(0);
    } else if (block.kind === 'audio') {
      if (recordingAudioRef.current) {
        recordingAudioRef.current = false;
        recordingAudioBlockIdRef.current = null;
        setRecordingAudioStartedAt(null);
        void runNoteRecorderWork(async () => {
          try { discardRecordingOutput(await stopNoteRecorder(noteRecorder)); } catch { /* The block is being removed. */ }
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        });
      }
      audioItems.forEach((item) => {
        pickerPreviewDisposerRef.current.dispose(item.previewUri);
        if (item.localRecordingId) removeUnreferencedLocalNoteRecordings(currentUser?.id, [item.localRecordingId], editorDraftId);
      });
      setAudioItems([]);
    } else if (block.kind === 'location') {
      handleClearLocation();
    } else if (block.kind === 'contact') {
      setContactItems([]);
    } else if (block.kind === 'group') {
      setGroupCardItems([]);
    }
  }, [audioItems, currentUser?.id, discardRecordingOutput, editorDraftId, handleClearLocation, mediaItems, noteRecorder, showcaseItems, textStatsStore]);

  const removeRecordedAudio = useCallback((item: EditorNoteMediaDraft) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    pickerPreviewDisposerRef.current.dispose(item.previewUri);
    if (item.localRecordingId) removeUnreferencedLocalNoteRecordings(currentUser?.id, [item.localRecordingId], editorDraftId);
    setAudioItems((current) => current.filter((audio) => audio.clientId !== item.clientId));
  }, [currentUser?.id, editorDraftId]);

  const revealMap = useCallback(() => {
    setMapRevealed(true);
  }, []);

  const addComposerBlock = useCallback((kind: NoteComposerBlockKind) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    // 标题、位置、名片和群名片在笔记模型里各只有一个值；文字、媒体等
    // 其余类型则是可重复的独立区块。工具栏只负责插入区块，区块内的
    // 操作按钮才负责打开选择器、上传或开始录音，避免点击工具栏就跳出面板。
    if (isNoteComposerSingletonKind(kind) && composerBlocks.some((block) => block.kind === kind)) {
      return;
    }
    let blockId: string;
    do { blockId = `${kind}-${++composerIdRef.current}`; } while (composerBlocksRef.current.some((block) => block.id === blockId));
    setComposerBlocks((current) => {
      const next = [...current, { id: blockId, kind }];
      composerBlocksRef.current = next;
      return next;
    });
    if (kind === 'text') {
      textBlocksByIdRef.current = { ...textBlocksByIdRef.current, [blockId]: [] };
      setTextBlocksById(textBlocksByIdRef.current);
    }
    if (kind === 'text') {
      scrollRef.current?.scrollTo({ y: 120, animated: true });
    } else if (kind === 'image' || kind === 'video' || kind === 'showcase') {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [composerBlocks]);

  const navigateBack = useCallback(() => {
    promptDraftExit();
  }, [promptDraftExit]);

  const toggleGroup = useCallback((groupId: string) => {
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  }, []);

  const openGroupCreate = useCallback(() => {
    if (availableGroups.length >= MAX_NOTE_GROUPS) {
      Alert.alert(
        t('notes.alerts.groupLimitTitle', { defaultValue: '分组已达上限' }),
        t('notes.alerts.groupLimitMessage', {
          max: MAX_NOTE_GROUPS,
          defaultValue: `最多只能创建 ${MAX_NOTE_GROUPS} 个分组。`,
        }),
      );
      return;
    }
    setGroupCreateOpen(true);
    requestAnimationFrame(() => groupCreateInputRef.current?.focus());
  }, [availableGroups.length, t]);

  const closeGroupSheet = useCallback(() => {
    setGroupSheetVisible(false);
    setGroupCreateOpen(false);
    setGroupCreateName('');
    setGroupCreating(false);
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (pendingSubmissionRef.current || saveInFlightRef.current) return;
    const name = groupCreateName.trim();
    if (!name || groupCreating) return;
    setGroupCreating(true);
    const request = ++groupCreateRequestRef.current;
    const ownerId = currentUser?.id;
    const isCurrentRequest = () => {
      const auth = useAuthStore.getState();
      return request === groupCreateRequestRef.current && auth.user?.id === ownerId &&
        auth.sessionEpoch === sessionEpoch && draftRouteKeyRef.current === draftRouteKey;
    };
    try {
      const created = await createNoteGroup(name);
      if (!isCurrentRequest() || pendingSubmissionRef.current || saveInFlightRef.current) return;
      setAvailableGroups((current) => (
        current.some((group) => group.id === created.id)
          ? current
          : [...current, created]
      ));
      setSelectedGroupIds((current) => (
        current.includes(created.id) ? current : [...current, created.id]
      ));
      setGroupCreateName('');
      setGroupCreateOpen(false);
    } catch (error) {
      if (!isCurrentRequest()) return;
      Alert.alert(
        t('notes.alerts.saveFailedTitle', { defaultValue: '保存失败' }),
        getApiErrorMessage(
          error,
          t('notes.alerts.saveGroupFailed', {
            defaultValue: '分组保存失败，请稍后再试。',
          }),
        ),
      );
      reportHandledFailure('noteGroups', 'createFromNoteEditor', error);
    } finally {
      if (isCurrentRequest()) setGroupCreating(false);
    }
  }, [currentUser?.id, draftRouteKey, groupCreateName, groupCreating, sessionEpoch, t]);

  const getTextError = useCallback((stats: NoteTextStats) => {
    switch (getNoteTextLimitKind(stats)) {
      case 'textTooLong':
        return t('notes.edit.textTooLong', {
          defaultValue:
            '正文（含段落换行）最多 {{max}} 字符，当前 {{count}} 字符。内容已保留，请缩短后保存。',
          max: MAX_NOTE_TEXT_LENGTH,
          count: stats.characters,
        });
      case 'tooManyParagraphs':
        return t('notes.edit.tooManyParagraphs', {
          defaultValue: '正文最多 {{max}} 段。内容已保留，请合并部分段落后保存。',
          max: MAX_NOTE_TEXT_BLOCKS,
        });
      default:
        return null;
    }
  }, [t]);
  const handleSubmit = useCallback(async () => {
    if (
      loading ||
      !isRouteDataReady ||
      isSubmitting ||
      groupCreating ||
      saveInFlightRef.current ||
      recordingAudioRef.current ||
      uploadInFlightRef.current ||
      uploadingSection !== null ||
      !canSubmitNoteMedia(mediaItems) ||
      !canSubmitNoteMedia(showcaseItems) ||
      !canSubmitNoteMedia(audioItems)
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
    if (!trimmedTitle) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      Alert.alert(
        t('notes.edit.validationTitle', { defaultValue: '请检查笔记内容' }),
        t('notes.edit.titleRequired', { defaultValue: '请填写标题' }),
        [{ text: t('common.ok'), onPress: () => titleInputRef.current?.focus() }],
      );
      return;
    }
    const currentTextBlocks = composerBlocks
      .filter((block) => block.kind === 'text')
      .map((block) => ({
        id: block.id,
        content: getTextOnlyBlocks(textBlocksByIdRef.current[block.id] ?? []),
      }));
    const currentBlocks = currentTextBlocks.flatMap((block) => block.content);
    const currentTextError = getTextError(getNoteTextStats(currentBlocks));
    if (currentTextError) {
      Alert.alert(
        t('notes.edit.validationTitle', { defaultValue: '请检查笔记内容' }),
        currentTextError,
      );
      return;
    }
    saveInFlightRef.current = true;
    const saveGeneration = saveGenerationRef.current;
    setIsSubmitting(true);
    let requestStarted = false;
    const retryingPending = pendingSubmissionRef.current !== null;
    try {
      const plainText = extractPlainText(currentBlocks);
      const firstMediaBlockId = composerBlocks.find(
        (block) => block.kind === 'image' || block.kind === 'video',
      )?.id;
      const firstShowcaseBlockId = composerBlocks.find((block) => block.kind === 'showcase')?.id;
      const mediaBlocks = composerBlocks.flatMap((block) => {
        const target: 'media' | 'showcase' | null = block.kind === 'showcase'
          ? 'showcase'
          : block.kind === 'image' || block.kind === 'video'
            ? 'media'
            : null;
        if (!target) return [];
        const items = target === 'showcase' ? showcaseItems : mediaItems;
        const fallbackId = target === 'showcase' ? firstShowcaseBlockId : firstMediaBlockId;
        return [{
          id: block.id,
          target,
          objectKeys: items
            .filter((item) => (mediaOwnerByClientIdRef.current[item.clientId] ?? fallbackId) === block.id)
            .map((item) => item.objectKey)
            .filter((key): key is string => typeof key === 'string' && key.length > 0),
        }];
      });
      const persistedContentJson = [
        ...currentBlocks,
        buildNoteComposerBlocksMetadata(
          [FIXED_TITLE_BLOCK, ...composerBlocks],
          currentTextBlocks,
          mediaBlocks,
        ),
      ];
      const rawSectionMedia = stripEditorMediaDrafts(mergeMedia(mediaItems));
      const rawSectionShowcase = stripEditorMediaDrafts(mergeMedia(showcaseItems));
      const rawSectionAudio = stripEditorMediaDrafts(mergeMedia(audioItems));
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
      const sectionAudio = normalizeSectionMedia(rawSectionAudio);
      const legacyMedia = mergeMedia([...sectionMedia, ...sectionShowcase, ...sectionAudio]);
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
        contentJson: persistedContentJson,
        sections: sanitizeNoteSectionsForServer({
          text: { content: plainText, contentJson: persistedContentJson },
          media: { items: sectionMedia },
          showcase: { items: sectionShowcase },
          audio: { items: sectionAudio },
          contacts: { items: contactItems },
          groups: { items: groupCardItems },
          location: nextLocation,
        }),
        groupIds: selectedGroupIds,
        media: legacyMedia,
        clientDraftID: editorDraftId,
      };
      const submission = pendingSubmissionRef.current ?? createPendingNoteSubmission(
        isEdit && id ? { ...input, pinned: pinnedRef.current } : { ...input, status: 'ACTIVE' },
        isEdit && id ? id : null,
      );
      // Persist before sending: an interrupted process must recover exactly
      // this write, never a newer payload under the consumed idempotency key.
      saveLocalNoteDraft(currentUser?.id, { ...buildCurrentDraftRecord(), pendingSubmission: submission });
      draftRemoteQueue.cancel();
      pendingSubmissionRef.current = submission;
      setPendingSubmission(submission);
      setTextBlocksById({ ...textBlocksByIdRef.current });
      titleInputRef.current?.blur();
      setGroupSheetVisible(false);
      setSortMode(false);
      setCardPickerKind(null);
      cardPickerRequestRef.current += 1;
      requestStarted = true;
      const result = submission.noteId
        ? await updateNote(submission.noteId, submission.input)
        : await createNote(submission.input);
      if (saveGenerationRef.current !== saveGeneration) return;
      if (!noteSubmissionMatchesResult(submission, result)) {
        if (result && typeof result.id === 'string') {
          const conflict = { ...submission, conflictingNoteId: result.id };
          pendingSubmissionRef.current = conflict;
          setPendingSubmission(conflict);
          saveLocalNoteDraft(currentUser?.id, { ...buildCurrentDraftRecord(), pendingSubmission: conflict });
        }
        throw new Error('Note submission outcome differs from the saved snapshot');
      }
      navigationRequestedRef.current = true;
      await draftSavePromiseRef.current.catch(() => undefined);
      if (saveGenerationRef.current !== saveGeneration) return;
      removeLocalNoteDraft(currentUser?.id, editorDraftId);
      cleanupRecordingCopies();
      await deleteNoteDraft(editorDraftId).catch(() => undefined);
      if (saveGenerationRef.current !== saveGeneration) return;
      completeNavigation(undefined, true);
    } catch (error) {
      if (saveGenerationRef.current !== saveGeneration) return;
      if (requestStarted && !retryingPending && isDefinitiveNoteSubmissionFailure(error)) {
        try {
          saveLocalNoteDraft(currentUser?.id, { ...buildCurrentDraftRecord(), pendingSubmission: undefined });
          pendingSubmissionRef.current = null;
          setPendingSubmission(null);
        } catch { /* Retain the recovery marker until it can be cleared durably. */ }
      }
      saveInFlightRef.current = false;
      navigationRequestedRef.current = false;
      setIsSubmitting(false);
      const fallback = requestStarted
        ? t('notes.edit.saveFailedMessage', { defaultValue: '保存失败，请稍后重试' })
        : t('notes.edit.pendingSubmitStorageFailed', { defaultValue: '无法在本机保留提交内容，尚未发送。请检查设备存储空间后重试。' });
      const message = pendingSubmissionRef.current?.conflictingNoteId
        ? t('notes.edit.pendingSubmitConflict', { defaultValue: '服务器已有不同的笔记内容，本机内容仍保留在草稿箱。请查看已保存笔记，再决定如何合并；本次不会删除草稿。' })
        : requestStarted ? getApiErrorMessage(error, fallback) : fallback;
      Alert.alert(
        t('notes.edit.saveFailedTitle', { defaultValue: '保存失败' }),
        message,
      );
      reportHandledFailure('noteEditor', 'save', error);
    }
  }, [
    getTextError,
    buildCurrentDraftRecord,
    draftRemoteQueue,
    id,
    isEdit,
    isRouteDataReady,
    isSubmitting,
    locationDraft,
    mediaItems,
    audioItems,
    contactItems,
    groupCardItems,
    groupCreating,
    completeNavigation,
    cleanupRecordingCopies,
    currentUser?.id,
    editorDraftId,
    selectedGroupIds,
    showcaseItems,
    t,
    title,
    uploadingSection,
    unrecoverableMediaCount,
    loading,
    composerBlocks,
  ]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      headerTitle: { color: colors.text },
      doneBtn: { backgroundColor: colors.primary },
      doneBtnText: { color: colors.white },
      doneBtnDisabled: { backgroundColor: colors.primary, opacity: 0.5 },
      titleInput: { color: colors.text },
      // 内容校验提示共用这一支红色，别在渲染里现拼 inline {color}。
      hintError: { color: colors.danger },
      dateText: { color: colors.textSecondary },
      groupButton: {
        backgroundColor: colors.surfaceMuted,
        borderColor: 'transparent',
      },
      groupButtonText: { color: colors.text },
      groupButtonSummary: { color: colors.textSecondary },
      groupSheetBackdrop: { backgroundColor: colors.overlay },
      groupSheet: { backgroundColor: colors.surface },
      groupSheetHandle: { backgroundColor: colors.surfaceBorder },
      groupSheetTitle: { color: colors.text },
      groupSheetRow: { backgroundColor: colors.background },
      groupSheetRowText: { color: colors.text },
      groupSheetRowMeta: { color: colors.textSecondary },
      groupSheetDone: { backgroundColor: colors.primary },
      groupSheetDoneText: { color: colors.white },
      sectionIcon: { backgroundColor: colors.primaryLight },
      secondarySection: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      heroCard: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      metaIcon: { backgroundColor: colors.primaryLight },
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
      sectionAction: {
        backgroundColor: colors.primaryLight,
        borderColor: 'transparent',
      },
      sectionActionText: { color: colors.iconAccent },
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
        color: colors.text,
        backgroundColor: colors.overlay,
      },
      composerFooter: {
        backgroundColor: colors.surface,
        borderTopColor: colors.surfaceBorder,
      },
      composerToolActive: {
        backgroundColor: colors.primaryLight,
      },
      composerSortChip: {
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.surfaceBorder,
      },
      composerSortButton: { backgroundColor: colors.primary },
      composerPreviewButton: { backgroundColor: colors.textSecondary },
    }),
    [colors],
  );

  const isDoneDisabled =
    loading ||
    !isRouteDataReady ||
    isSubmitting ||
    groupCreating ||
    recordingAudioStartedAt !== null ||
    uploadingSection !== null ||
    !canSubmitNoteMedia(mediaItems) ||
    !canSubmitNoteMedia(showcaseItems) ||
    !canSubmitNoteMedia(audioItems);
  const selectedGroupNames = useMemo(
    () => availableGroups
      .filter((group) => selectedGroupIds.includes(group.id))
      .map((group) => group.name),
    [availableGroups, selectedGroupIds],
  );
  const groupSummary = selectedGroupNames.length > 0
    ? selectedGroupNames.join('、')
    : t('notes.edit.noGroups', { defaultValue: '未加入任何分组' });
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
  const audioSectionStatus = uploadingSection === 'audio'
    ? t('notes.edit.mediaUploading', { defaultValue: '正在上传' })
    : recordingAudioStartedAt !== null
      ? t('notes.edit.audioRecording', { defaultValue: '录音中，点击停止' })
      : `${audioItems.length} ${t('notes.edit.itemsCount', { defaultValue: '项' })}`;

  // 眉标式小节头：图标 + 标签 + 右侧计数，去掉解释性副标题让内容当主角。
  // meta 收 ReactNode 而不是 string：正文那一格要放实时字数，它必须是一个能自己
  // 订阅、自己重渲染的小节点，否则整屏都得跟着每个键击重渲染一次。
  const renderSectionHeader = (
    icon: keyof typeof Ionicons.glyphMap,
    sectionTitle: string,
    meta?: ReactNode,
    onRemove?: () => void,
  ) => (
    <View style={s.sectionHeader}>
      <View style={[s.sectionIcon, d.sectionIcon]}>
        <Ionicons name={icon} size={16} color={colors.iconAccent} />
      </View>
      <Text style={[s.sectionHeading, d.sectionHeading]}>{sectionTitle}</Text>
      {meta ? (
        <View style={s.sectionHeaderMeta}>
          <Text style={[s.sectionHeaderMetaText, d.sectionHeaderMeta]}>{meta}</Text>
        </View>
      ) : null}
      {onRemove ? (
        <Pressable
          style={s.sectionRemoveButton}
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${t('notes.actions.delete', { defaultValue: '删除' })}${sectionTitle}`}
        >
          <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );

  const getMediaItemsForBlock = useCallback((
    items: EditorNoteMediaDraft[],
    target: SectionMediaTarget,
    blockId: string,
  ) => {
    const fallbackBlockId = composerBlocks.find((block) =>
      target === 'showcase' ? block.kind === 'showcase' : block.kind === 'image' || block.kind === 'video',
    )?.id;
    return items.filter((item) => (mediaOwnerByClientId[item.clientId] ?? fallbackBlockId) === blockId);
  }, [composerBlocks, mediaOwnerByClientId]);

  const renderMediaList = useCallback((
    items: EditorNoteMediaDraft[],
    target: SectionMediaTarget,
    onAdd: () => void,
    addLabel: string,
  ) => {
    const addTile = (
      <Pressable
        style={[s.mediaPreviewTile, s.mediaAddTile, d.mediaPreviewTile]}
        onPress={onAdd}
        disabled={!isRouteDataReady || uploadingSection !== null}
        accessibilityRole="button"
        accessibilityLabel={addLabel}
      >
        <Ionicons name="add" size={28} color={colors.iconAccent} />
        <Text style={[s.mediaAddLabel, d.emptyText]}>{addLabel}</Text>
      </Pressable>
    );
    if (items.length === 0) {
      return (
        <Pressable
          style={[s.emptyTray, d.emptyTray]}
          onPress={onAdd}
          disabled={!isRouteDataReady || uploadingSection !== null}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.iconAccent} />
          <Text style={[s.emptySectionText, d.emptyText]}>
            {addLabel}
          </Text>
        </Pressable>
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
        {addTile}
      </View>
    );
  }, [
    colors.iconAccent,
    colors.text,
    d.emptyText,
    d.emptyTray,
    d.mediaBadge,
    d.mediaMeta,
    d.mediaPreviewTile,
    handleRemoveSectionMedia,
    isRouteDataReady,
    uploadingSection,
    t,
  ]);

  function renderComposerSection(block: NoteComposerBlock, blockIndex: number): ReactNode {
    const { kind } = block;
    const previousBlocks = composerBlocks.slice(0, blockIndex);
    const isFirstAudioBlock = !previousBlocks.some((item) => item.kind === 'audio');
    switch (kind) {
      case 'title':
        return (
          <View style={[s.heroCard, d.heroCard]}>
            <TextInput
              ref={titleInputRef}
              style={[s.titleInput, d.titleInput]}
              placeholder={t('notes.edit.titlePlaceholder', { defaultValue: '标题' })}
              placeholderTextColor={colors.textSecondary}
              value={title}
              editable={!isEditingLocked}
              onChangeText={(value) => { if (!pendingSubmissionRef.current && !saveInFlightRef.current) setTitle(value); }}
              maxLength={MAX_NOTE_TITLE_LENGTH}
              returnKeyType="next"
            />

            <View style={s.metaRow}>
              <View style={[s.metaIcon, d.metaIcon]}>
                <Ionicons name="calendar-outline" size={13} color={colors.iconAccent} />
              </View>
              <Text style={[s.dateText, d.dateText]}>{dateStr}</Text>
            </View>

            <View style={s.groupSection}>
              <Pressable
                style={[s.groupButton, d.groupButton]}
                disabled={isEditingLocked}
                onPress={() => {
                  setGroupCreateOpen(false);
                  setGroupCreateName('');
                  setGroupCreating(false);
                  setGroupSheetVisible(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('notes.edit.groupsLabel', { defaultValue: '分组' })}
              >
                <View style={[s.metaIcon, d.metaIcon]}>
                  <Ionicons name="folder-open-outline" size={15} color={colors.iconAccent} />
                </View>
                <View style={s.groupButtonTextWrap}>
                  <Text style={[s.groupButtonText, d.groupButtonText]}>
                    {t('notes.edit.groupsLabel', { defaultValue: '分组' })}
                  </Text>
                  <Text style={[s.groupButtonSummary, d.groupButtonSummary]} numberOfLines={1}>
                    {groupSummary}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        );
      case 'text':
        return (
          <>
        <View style={[s.sectionBlock, d.sectionShell]}>
          {renderSectionHeader(
            'text-outline',
            t('notes.edit.sections.text', { defaultValue: '文字' }),
            <NoteTextStatsConsumer store={textStatsStore}>
              {(stats) =>
                t('notes.edit.textCount', {
                  defaultValue: '正文长度 {{count}} / {{max}}',
                  count: stats.characters,
                  max: MAX_NOTE_TEXT_LENGTH,
                })
              }
            </NoteTextStatsConsumer>,
            () => handleRemoveComposerBlock(block),
          )}
          <View style={[s.textEditorFrame, d.editorFrame]}>
            {editorMounted ? (
              <NoteBlockEditor
                key={isEditingLocked ? 'locked' : 'editing'}
                initialContent={textBlocksById[block.id] ?? null}
                onContentChange={(newBlocks) => handleContentChange(block.id, newBlocks)}
                mediaToolbarEnabled={false}
                editable={!isEditingLocked}
              />
            ) : null}
          </View>
          <NoteTextStatsConsumer store={textStatsStore}>
            {(stats) => {
              const textError = getTextError(stats);
              return textError ? (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[s.sectionSubtitle, d.hintError]}
                >
                  {textError}
                </Text>
              ) : null;
            }}
          </NoteTextStatsConsumer>
        </View>

          </>
        );
      case 'image':
        return (
          <>
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

        <View style={[s.sectionBlock, s.secondarySection, d.secondarySection]}>
          {renderSectionHeader(
            'images-outline',
            t('notes.edit.sections.media', { defaultValue: '多媒体' }),
            mediaSectionStatus,
            () => handleRemoveComposerBlock(block),
          )}
          {renderMediaList(
            getMediaItemsForBlock(mediaItems, 'media', block.id),
            'media',
            () => void handleAddSectionMedia({ target: 'media', kind: 'media', blockId: block.id }),
            t('notes.edit.addMedia', { defaultValue: '添加多媒体' }),
          )}
        </View>

          </>
        );
      case 'video':
        return (
          <View style={[s.sectionBlock, s.secondarySection, d.secondarySection]}>
            {renderSectionHeader(
              'videocam-outline',
              t('notes.edit.composer.video', { defaultValue: '视频' }),
              mediaSectionStatus,
              () => handleRemoveComposerBlock(block),
            )}
            {renderMediaList(
              getMediaItemsForBlock(mediaItems, 'media', block.id),
              'media',
              () => void handleAddSectionMedia({ target: 'media', kind: 'video', blockId: block.id }),
              t('notes.edit.addVideo', { defaultValue: '添加视频' }),
            )}
          </View>
        );
      case 'showcase':
        return (
          <>
        <View style={[s.sectionBlock, s.secondarySection, d.secondarySection]}>
          {renderSectionHeader(
            'albums-outline',
            t('notes.edit.sections.showcase', { defaultValue: '展示' }),
            showcaseSectionStatus,
            () => handleRemoveComposerBlock(block),
          )}
          {renderMediaList(
            getMediaItemsForBlock(showcaseItems, 'showcase', block.id),
            'showcase',
            () => void handleAddSectionMedia({ target: 'showcase', kind: 'video', blockId: block.id }),
            t('notes.edit.addShowcaseVideo', { defaultValue: '添加展示视频' }),
          )}
        </View>

          </>
        );
      case 'audio':
        return (
          <View style={[s.sectionBlock, s.secondarySection, d.secondarySection]}>
            {renderSectionHeader('mic-outline', t('notes.edit.composer.audio', { defaultValue: '录音' }), audioSectionStatus, () => handleRemoveComposerBlock(block))}
            <View style={s.sectionActions}>
              <Pressable
                style={[s.sectionAction, d.sectionAction]}
                onPress={() => void handleAddAudioFile(block.id)}
                disabled={!isRouteDataReady || uploadingSection !== null || recordingAudioStartedAt !== null}
              >
                <Ionicons name="cloud-upload-outline" size={17} color={colors.text} />
                <Text style={[s.sectionActionText, d.sectionActionText]}>
                  {t('notes.edit.uploadAudio', { defaultValue: '上传音频' })}
                </Text>
              </Pressable>
              <Pressable
                style={[s.sectionAction, d.sectionAction]}
                onPress={() => void toggleNoteRecording(block.id)}
                disabled={!isRouteDataReady || uploadingSection !== null || (recordingAudioStartedAt === null && audioItems.some((item) => item.uploadStatus !== 'UPLOADED'))}
              >
                <Ionicons name={recordingAudioStartedAt !== null ? 'stop-circle-outline' : 'mic-outline'} size={17} color={colors.text} />
                <Text style={[s.sectionActionText, d.sectionActionText]}>
                  {recordingAudioStartedAt !== null
                    ? t('notes.edit.stopRecording', { defaultValue: '停止录音' })
                    : t('notes.edit.startRecording', { defaultValue: '开始录音' })}
                </Text>
              </Pressable>
            </View>
            {isFirstAudioBlock && audioItems.length > 0 ? (
              <View style={s.audioList}>
                {audioItems.map((item) => (
                  <View key={item.clientId} style={[s.audioRow, d.locationPreviewCard]}>
                    <Ionicons name="mic" size={18} color={colors.iconAccent} />
                    <Text style={[s.mediaMeta, d.mediaMeta, { flex: 1 }]}>
                      {typeof item.durationMs === 'number' && item.durationMs > 0
                        ? t('notes.edit.audioDuration', { defaultValue: '{{seconds}} 秒', seconds: Math.max(1, Math.round(item.durationMs / 1000)) })
                        : t('notes.edit.audioItem', { defaultValue: '音频' })}
                    </Text>
                    {item.uploadStatus !== 'UPLOADED' && item.previewUri ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={t('common.retry')}
                        onPress={() => void retryRecordedAudio(item)} disabled={uploadingSection !== null || recordingAudioStartedAt !== null}>
                        <Text style={{ color: colors.primary }}>{t('common.retry')}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={t('notes.actions.delete') + t('notes.edit.audioItem')} onPress={() => removeRecordedAudio(item)} hitSlop={8}>
                      <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      case 'contact':
        return (
          <View style={[s.sectionBlock, s.secondarySection, d.secondarySection]}>
            {renderSectionHeader('person-outline', t('notes.edit.composer.contact', { defaultValue: '名片' }), `${contactItems.length} ${t('notes.edit.itemsCount', { defaultValue: '项' })}`, () => handleRemoveComposerBlock(block))}
            <View style={s.sectionActions}>
              <Pressable style={[s.sectionAction, d.sectionAction]} onPress={() => void openCardPicker('contact')} disabled={!isRouteDataReady}>
                <Ionicons name="person-add-outline" size={17} color={colors.text} />
                <Text style={[s.sectionActionText, d.sectionActionText]}>{t('notes.edit.addContact', { defaultValue: '选择联系人' })}</Text>
              </Pressable>
            </View>
            {contactItems.map((item) => {
              const avatar = getNoteCardAvatar(item);
              return (
                <View key={item.id} style={[s.cardRow, d.locationPreviewCard]}>
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={s.cardRowAvatar} contentFit="cover" />
                  ) : (
                    <View style={[s.cardRowAvatar, s.cardRowAvatarFallback, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="person-outline" size={19} color={colors.iconAccent} />
                    </View>
                  )}
                  <Text style={[s.mediaTitle, d.mediaTitle, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
                </View>
              );
            })}
          </View>
        );
      case 'group':
        return (
          <View style={[s.sectionBlock, s.secondarySection, d.secondarySection]}>
            {renderSectionHeader('people-outline', t('notes.edit.composer.group', { defaultValue: '群名片' }), `${groupCardItems.length} ${t('notes.edit.itemsCount', { defaultValue: '项' })}`, () => handleRemoveComposerBlock(block))}
            <View style={s.sectionActions}>
              <Pressable style={[s.sectionAction, d.sectionAction]} onPress={() => void openCardPicker('group')} disabled={!isRouteDataReady}>
                <Ionicons name="people-outline" size={17} color={colors.text} />
                <Text style={[s.sectionActionText, d.sectionActionText]}>{t('notes.edit.addGroup', { defaultValue: '选择群组' })}</Text>
              </Pressable>
            </View>
            {groupCardItems.map((item) => {
              const avatar = getNoteCardAvatar(item);
              return (
                <View key={item.id} style={[s.cardRow, d.locationPreviewCard]}>
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={s.cardRowAvatar} contentFit="cover" />
                  ) : (
                    <View style={[s.cardRowAvatar, s.cardRowAvatarFallback, { backgroundColor: colors.primaryLight }]}>
                      <Ionicons name="people-outline" size={19} color={colors.iconAccent} />
                    </View>
                  )}
                  <Text style={[s.mediaTitle, d.mediaTitle, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
                </View>
              );
            })}
          </View>
        );
      case 'location':
        return (
          <>
        <View style={[s.sectionBlock, s.secondarySection, d.secondarySection]}>
          {renderSectionHeader(
            'location-outline',
            t('notes.edit.sections.location', { defaultValue: '位置' }),
            hasLocation
              ? t('notes.edit.sections.locationSelected', { defaultValue: '已选择' })
              : t('notes.edit.sections.locationEmpty', { defaultValue: '可选' }),
            () => handleRemoveComposerBlock(block),
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
          </>
        );
      default:
        return null;
    }
  }

  const editableComposerBlocks = useMemo(
    () => composerBlocks.filter((block) => block.kind !== 'title'),
    [composerBlocks],
  );
  const previewGroups = useMemo(
    () => selectedGroupNames.map((name, index) => ({ id: `${name}-${index}`, name })),
    [selectedGroupNames],
  );
  const buildPreviewData = useCallback((): NotePreviewData => {
    const toPreviewMedia = (item: EditorNoteMediaDraft) => {
      const url = item.previewUri ?? item.url;
      return url ? { ...item, url } : null;
    };
    const previewMediaItems = mediaItems.flatMap((item) => toPreviewMedia(item) ?? []);
    const previewShowcaseItems = showcaseItems.flatMap((item) => toPreviewMedia(item) ?? []);
    const previewAudioItems = audioItems.flatMap((item) => toPreviewMedia(item) ?? []);
    const previewTextBlocks = composerBlocks
      .filter((block) => block.kind === 'text')
      .flatMap((block) => textBlocksById[block.id] ?? []);
    const previewTextContent = extractPlainText(previewTextBlocks);
    // Use the same canonical section builder as the recipient detail page so the
    // editor preview cannot drift from what gets rendered after saving.
    const sections = buildNoteSections({
      content: previewTextContent,
      contentJson: previewTextBlocks,
      media: [...previewMediaItems, ...previewShowcaseItems, ...previewAudioItems],
      sections: {
        text: { content: previewTextContent, contentJson: previewTextBlocks },
        media: { items: previewMediaItems },
        showcase: { items: previewShowcaseItems },
        audio: { items: previewAudioItems },
        contacts: { items: contactItems },
        groups: { items: groupCardItems },
        location: hasLocation
          ? {
              title: locationDraft.title || null,
              address: locationDraft.address || null,
              latitude: locationDraft.latitude,
              longitude: locationDraft.longitude,
            }
          : null,
      },
    });

    const imageItems = getNoteViewerImages(sections).map((item) => ({ uri: item.url, objectKey: item.objectKey }));
    const layout = [buildNoteComposerBlocksMetadata(
      composerBlocks,
      composerBlocks.filter((block) => block.kind === 'text').map((block) => ({ id: block.id, content: textBlocksById[block.id] ?? [] })),
      composerBlocks.flatMap((block) => {
        const target = block.kind === 'showcase' ? 'showcase' as const : block.kind === 'image' || block.kind === 'video' ? 'media' as const : null;
        return target ? [{ id: block.id, target, objectKeys: (target === 'showcase' ? showcaseItems : mediaItems).filter(
          (item) => mediaOwnerByClientId[item.clientId] === block.id,
        ).map((item) => item.objectKey || item.url || item.previewUri || '') }] : [];
      }),
    )];
    const sectionOrder: NoteSectionKind[] = [];
    for (const block of editableComposerBlocks) {
      if (block.kind === 'title') continue;
      const kind: NoteSectionKind =
        block.kind === 'image' || block.kind === 'video' ? 'media' : block.kind;
      if (!sectionOrder.includes(kind)) sectionOrder.push(kind);
    }
    // The recipient view always keeps a text section in the document structure,
    // including an empty note. Append it when the author has not added text yet.
    if (!sectionOrder.includes('text')) sectionOrder.push('text');

    return { sections, imageItems, sectionOrder, layout };
  }, [
    audioItems,
    contactItems,
    composerBlocks,
    editableComposerBlocks,
    groupCardItems,
    hasLocation,
    locationDraft,
    mediaItems,
    mediaOwnerByClientId,
    showcaseItems,
    textBlocksById,
  ]);
  useEffect(() => {
    previewDataSnapshotRef.current = null;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      previewDataSnapshotRef.current = buildPreviewData();
      if (previewVisibleRef.current) setPreviewDataVersion((version) => version + 1);
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [buildPreviewData]);
  const previewData = useMemo(() => {
    if (!previewVisible || !previewContentReady) return null;
    // The version state only invalidates this memo while the preview is open;
    // editing can refresh the ref without rerendering the editor itself.
    void previewDataVersion;
    return previewDataSnapshotRef.current;
  }, [previewContentReady, previewDataVersion, previewVisible]);
  const openPreview = useCallback(() => {
    setTextBlocksById({ ...textBlocksByIdRef.current });
    setPreviewImageViewerVisible(false);
    setPreviewContentReady(false);
    setPreviewVisible(true);
  }, []);
  const closePreview = useCallback(() => {
    previewReadyTaskRef.current?.cancel();
    previewReadyTaskRef.current = null;
    setPreviewImageViewerVisible(false);
    setPreviewContentReady(false);
    setPreviewVisible(false);
  }, []);
  const handlePreviewShown = useCallback(() => {
    previewReadyTaskRef.current?.cancel();
    previewReadyTaskRef.current = InteractionManager.runAfterInteractions(() => {
      previewReadyTaskRef.current = null;
      setPreviewContentReady(true);
    });
  }, []);
  useEffect(() => () => {
    previewReadyTaskRef.current?.cancel();
  }, []);
  const handlePreviewImagePress = useCallback((uri: string, objectKey?: string) => {
    const imageItems = previewData?.imageItems ?? [];
    const index = imageItems.findIndex((item) =>
      objectKey
        ? item.objectKey === objectKey || (!item.objectKey && item.uri === uri)
        : item.uri === uri,
    );
    if (index < 0) return;
    setPreviewImageViewerIndex(index);
    setPreviewImageViewerVisible(true);
  }, [previewData]);
  const openCommittedNote = useCallback(async () => {
    const noteId = pendingSubmissionRef.current?.conflictingNoteId;
    if (!noteId || saveInFlightRef.current) return;
    if (!await persistDraft()) {
      Alert.alert(t('common.errorOccurred'), t('notes.drafts.saveFailed'));
      return;
    }
    const auth = useAuthStore.getState();
    if (draftRouteKeyRef.current === draftRouteKey && auth.user?.id === currentUser?.id && auth.sessionEpoch === sessionEpoch) {
      router.push({ pathname: '/(tabs)/profile/notes/[id]', params: { id: noteId } } as never);
    }
  }, [currentUser?.id, draftRouteKey, persistDraft, router, sessionEpoch, t]);

  if (loading || isDraftLoading) {
    return (
      <View style={[s.container, d.container, s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingContainer
      style={[s.container, d.container, { paddingTop: insets.top }]}
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
          accessibilityRole="button"
          style={[s.doneBtn, d.doneBtn, isDoneDisabled && d.doneBtnDisabled]}
          onPress={handleSubmit}
          disabled={isDoneDisabled}
        >
          <Text style={[s.doneBtnText, d.doneBtnText]}>
            {isSubmitting
              ? t('notes.edit.saving', { defaultValue: '保存中...' })
              : pendingSubmission ? t('common.retry', { defaultValue: '重试' }) : t('notes.edit.done', { defaultValue: '完成' })}
          </Text>
        </Pressable>
      </View>

      {pendingSubmission ? <Text accessibilityRole="alert" style={[s.sectionSubtitle, d.hintError]}>
        {pendingSubmission.conflictingNoteId
          ? t('notes.edit.pendingSubmitConflict', { defaultValue: '服务器已有不同的笔记内容，本机内容仍保留在草稿箱。请查看已保存笔记，再决定如何合并；本次不会删除草稿。' })
          : t('notes.edit.pendingSubmitMessage', { defaultValue: '保存结果尚未确认，编辑已暂停。请点击「重试」确认原提交；返回会保留内容，之后可从草稿箱继续重试。' })}
      </Text> : null}
      {pendingSubmission?.conflictingNoteId ? <Pressable accessibilityRole="button" onPress={() => void openCommittedNote()} disabled={isSubmitting}>
        <Text style={[s.sectionSubtitle, d.groupButtonText]}>{t('notes.edit.openCommittedNote', { defaultValue: '查看已保存笔记' })}</Text>
      </Pressable> : null}
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 124 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View pointerEvents={isEditingLocked ? 'none' : 'auto'}>
          <View key={FIXED_TITLE_BLOCK.id}>
            {renderComposerSection(FIXED_TITLE_BLOCK, 0)}
          </View>
          {editableComposerBlocks.map((block, index) => (
            <View key={block.id}>{renderComposerSection(block, index)}</View>
          ))}
        </View>
      </ScrollView>
      <View
        style={[
          s.composerFooter,
          d.composerFooter,
          { paddingBottom: Math.max(insets.bottom, Spacing.xs) },
        ]}
      >
        <View style={s.composerToolbar}>
          {COMPOSER_ACTIONS.map((action) => {
            const label = t(`notes.edit.composer.${action.translationKey}`, {
              defaultValue: action.defaultLabel,
            });
            return (
              <Pressable
                key={action.kind}
                style={s.composerTool}
                disabled={isEditingLocked}
                onPress={() => addComposerBlock(action.kind)}
                accessibilityRole="button"
                accessibilityLabel={label}
              >
                <View style={s.composerToolIcon}>
                  <Ionicons
                    name={action.icon}
                    size={21}
                    color={colors.textSecondary}
                  />
                </View>
                <Text
                  style={[s.composerToolLabel, { color: colors.textSecondary }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={s.composerFooterActions}>
          <Pressable
            style={[s.composerFooterButton, d.composerSortButton]}
            disabled={isEditingLocked}
            onPress={() => setSortMode(true)}
            accessibilityRole="button"
            accessibilityLabel={t('notes.edit.composer.sort', { defaultValue: '排序' })}
          >
            <Ionicons name="swap-vertical" size={18} color={colors.white} />
            <Text style={[s.composerFooterButtonText, { color: colors.white }]}>
              {t('notes.edit.composer.sort', { defaultValue: '排序' })}
            </Text>
          </Pressable>
          <Pressable
            style={[s.composerFooterButton, d.composerPreviewButton]}
            onPress={openPreview}
            accessibilityRole="button"
            accessibilityLabel={t('notes.edit.composer.preview', { defaultValue: '预览' })}
          >
            <Ionicons name="eye-outline" size={18} color={colors.white} />
            <Text style={[s.composerFooterButtonText, { color: colors.white }]}>
              {t('notes.edit.composer.preview', { defaultValue: '预览' })}
            </Text>
          </Pressable>
        </View>
      </View>
      <BottomSheetModal
        visible={sortMode}
        onClose={() => setSortMode(false)}
        backdropStyle={d.groupSheetBackdrop}
        sheetStyle={[
          s.composerSortSheet,
          {
            backgroundColor: colors.surface,
            paddingBottom: Math.max(insets.bottom, Spacing.lg),
          },
        ]}
      >
        <View style={[s.composerSortHandle, { backgroundColor: colors.surfaceBorder }]} />
        <View style={s.composerSortHeader}>
          <Text style={[s.composerSortTitle, { color: colors.text }]}>
            {t('notes.edit.composer.sort', { defaultValue: '排序' })}
          </Text>
          <Pressable
            onPress={() => setSortMode(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.close', { defaultValue: '关闭' })}
          >
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView
          style={s.composerSortList}
          showsVerticalScrollIndicator={false}
          scrollEnabled={draggingComposerBlockId === null}
        >
          {editableComposerBlocks.length === 0 ? (
            <Text style={[s.composerSortEmpty, { color: colors.textSecondary }]}>
              {t('notes.edit.composer.sortEmpty', { defaultValue: '还没有可排序的内容' })}
            </Text>
          ) : (
            editableComposerBlocks.map((block, index) => {
              const action = COMPOSER_ACTIONS.find((item) => item.kind === block.kind);
              if (!action) return null;
              const baseLabel = t(`notes.edit.composer.${action.translationKey}`, {
                defaultValue: action.defaultLabel,
              });
              const ordinal = editableComposerBlocks
                .slice(0, index + 1)
                .filter((item) => item.kind === block.kind).length;
              const hasDuplicate = editableComposerBlocks.some(
                (item) => item.kind === block.kind && editableComposerBlocks.indexOf(item) > index,
              );
              const label = hasDuplicate || ordinal > 1
                ? `${baseLabel} ${ordinal}`
                : baseLabel;
              const isDragging = draggingComposerBlockId === block.id;
              let rowShift = 0;
              if (
                !isDragging &&
                composerDragStartIndex !== null &&
                composerDragActiveIndex !== null
              ) {
                if (
                  composerDragActiveIndex > composerDragStartIndex &&
                  index > composerDragStartIndex &&
                  index <= composerDragActiveIndex
                ) {
                  rowShift = -COMPOSER_SORT_ROW_HEIGHT;
                } else if (
                  composerDragActiveIndex < composerDragStartIndex &&
                  index >= composerDragActiveIndex &&
                  index < composerDragStartIndex
                ) {
                  rowShift = COMPOSER_SORT_ROW_HEIGHT;
                }
              }
              return (
                <Animated.View
                  key={block.id}
                  style={[
                    s.composerSortListRow,
                    {
                      borderBottomColor: colors.divider,
                      backgroundColor: colors.surface,
                    },
                    isDragging
                      ? {
                          backgroundColor: colors.surfaceMuted,
                          borderRadius: Radius.md,
                          transform: [{ translateY: composerDragY }],
                          zIndex: 2,
                        }
                      : rowShift
                        ? {
                            transform: [{ translateY: rowShift }],
                          }
                        : null,
                  ]}
                >
                  <Text style={[s.composerSortIndex, { color: colors.textSecondary }]}>
                    {index + 1}
                  </Text>
                  <Text style={[s.composerSortRowLabel, { color: colors.text }]} numberOfLines={1}>
                    {label}
                  </Text>
                  <View
                    style={[s.composerSortDragHandle, { backgroundColor: colors.background }]}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={t('notes.edit.composer.reorderA11y', {
                      defaultValue: '调整{{label}}的位置',
                      label,
                    })}
                    accessibilityValue={{ text: `${index + 1} / ${editableComposerBlocks.length}` }}
                    {...getComposerDragResponder(block.id).panHandlers}
                  >
                    <Ionicons
                      name="reorder-three-outline"
                      size={24}
                      color={colors.textSecondary}
                    />
                  </View>
                </Animated.View>
              );
            })
          )}
        </ScrollView>
      </BottomSheetModal>
      {previewVisible ? (
        <Modal
          visible
          animationType="slide"
          onShow={handlePreviewShown}
          onRequestClose={() => {
            closePreview();
          }}
        >
          <View style={[s.previewRoot, d.container, { paddingTop: insets.top }]}>
            <View style={s.previewHeader}>
              <Pressable
                onPress={closePreview}
                hitSlop={8}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            {previewContentReady && previewData ? (
              <NoteDocumentBody
                title={title}
                createdAt={createdAtIso}
                groups={previewGroups}
                sections={previewData.sections}
                order={previewData.sectionOrder}
                layout={previewData.layout}
                lazyMedia
                virtualized
                contentPaddingBottom={insets.bottom + Spacing.xl}
                onImagePress={handlePreviewImagePress}
              />
            ) : (
              <View style={s.previewLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
          </View>
        </Modal>
      ) : null}
      {previewVisible && previewImageViewerVisible && previewData ? (
        <ImageViewer
          images={previewData.imageItems.map((item) => item.uri)}
          cacheKeys={previewData.imageItems.map((item) => item.objectKey)}
          visible
          initialIndex={previewImageViewerIndex}
          onClose={() => setPreviewImageViewerVisible(false)}
        />
      ) : null}
      <Modal
        visible={cardPickerKind !== null && cardPickerSessionRef.current?.userId === (currentUser?.id ?? null) && cardPickerSessionRef.current?.epoch === sessionEpoch}
        transparent
        animationType="slide"
        onRequestClose={closeCardPicker}
      >
        <View style={s.cardPickerBackdrop}>
          <View
            style={[
              s.cardPickerSheet,
              d.groupSheet,
              { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
            ]}
          >
            <View style={[s.groupSheetHandle, d.groupSheetHandle]} />
            <Text style={[s.groupSheetTitle, d.groupSheetTitle]}>
              {cardPickerKind === 'contact'
                ? t('notes.edit.contactPickerTitle', { defaultValue: '选择联系人' })
                : t('notes.edit.groupPickerTitle', { defaultValue: '选择群组' })}
            </Text>
            <View
              style={[
                s.cardPickerSearchWrap,
                { backgroundColor: colors.background, borderColor: colors.surfaceBorder },
              ]}
            >
              <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
              <TextInput
                style={[s.cardPickerSearch, { color: colors.text }]}
                value={cardPickerSearch}
                onChangeText={setCardPickerSearch}
                placeholder={cardPickerKind === 'contact'
                  ? t('notes.edit.contactSearchPlaceholder', { defaultValue: '搜索联系人' })
                  : t('notes.edit.groupSearchPlaceholder', { defaultValue: '搜索群组' })}
                placeholderTextColor={colors.textSecondary}
                returnKeyType="search"
                autoCorrect={false}
              />
              {cardPickerSearch ? (
                <Pressable
                  onPress={() => setCardPickerSearch('')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
            {cardPickerLoading ? (
              <ActivityIndicator
                style={s.cardPickerLoading}
                color={colors.primary}
              />
            ) : (
              <ScrollView
                style={s.cardPickerList}
                contentContainerStyle={s.cardPickerListContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {cardPickerKind === 'contact' ? (
                  filteredContactPickerItems.length > 0 ? filteredContactPickerItems.map((item) => {
                    const selected = selectedCardIds.includes(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        style={[s.cardPickerRow, d.groupSheetRow]}
                        onPress={() => setSelectedCardIds((current) => selected ? current.filter((id) => id !== item.id) : [...current, item.id])}
                        accessibilityRole="checkbox"
                        accessibilityLabel={item.name}
                        accessibilityState={{ checked: selected }}
                      >
                        {item.avatarUrl ? (
                          <Image source={{ uri: item.avatarUrl }} style={s.cardPickerAvatar} contentFit="cover" />
                        ) : (
                          <View style={[s.cardPickerAvatar, s.cardPickerAvatarFallback, { backgroundColor: colors.primaryLight }]}>
                            <Ionicons name="person-outline" size={19} color={colors.iconAccent} />
                          </View>
                        )}
                        <View style={s.groupSheetRowTextWrap}>
                          <Text style={[s.groupSheetRowText, d.groupSheetRowText]} numberOfLines={1}>{item.name}</Text>
                          {item.subtitle ? (
                            <Text style={[s.groupSheetRowMeta, d.groupSheetRowMeta]} numberOfLines={1}>{item.subtitle}</Text>
                          ) : null}
                        </View>
                        <View style={s.cardPickerCheck}>
                          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.primary : colors.textSecondary} />
                        </View>
                      </Pressable>
                    );
                  }) : (
                    <Text style={[s.cardPickerEmpty, d.groupSheetRowMeta]}>
                      {t('notes.edit.cardPickerNoResults', { defaultValue: '没有匹配结果' })}
                    </Text>
                  )
                ) : (
                  filteredCircleItems.length > 0 ? filteredCircleItems.map((item) => {
                    const selected = selectedCardIds.includes(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        style={[s.cardPickerRow, d.groupSheetRow]}
                        onPress={() => setSelectedCardIds((current) => selected ? current.filter((id) => id !== item.id) : [...current, item.id])}
                        accessibilityRole="checkbox"
                        accessibilityLabel={item.name}
                        accessibilityState={{ checked: selected }}
                      >
                        {item.avatarUrl ? (
                          <Image source={{ uri: item.avatarUrl }} style={s.cardPickerAvatar} contentFit="cover" />
                        ) : (
                          <View style={[s.cardPickerAvatar, s.cardPickerAvatarFallback, { backgroundColor: colors.primaryLight }]}>
                            <Ionicons name="people-outline" size={19} color={colors.iconAccent} />
                          </View>
                        )}
                        <View style={s.groupSheetRowTextWrap}>
                          <Text style={[s.groupSheetRowText, d.groupSheetRowText]} numberOfLines={1}>{item.name}</Text>
                        </View>
                        <View style={s.cardPickerCheck}>
                          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? colors.primary : colors.textSecondary} />
                        </View>
                      </Pressable>
                    );
                  }) : (
                    <Text style={[s.cardPickerEmpty, d.groupSheetRowMeta]}>
                      {t('notes.edit.cardPickerNoResults', { defaultValue: '没有匹配结果' })}
                    </Text>
                  )
                )}
              </ScrollView>
            )}
            <View style={s.cardPickerActions}>
              <Pressable style={[s.composerFooterButton, s.cardPickerActionButton, d.composerPreviewButton]} onPress={closeCardPicker}>
                <Text style={[s.composerFooterButtonText, { color: colors.white }]}>{t('common.cancel', { defaultValue: '取消' })}</Text>
              </Pressable>
              <Pressable
                style={[
                  s.composerFooterButton,
                  s.cardPickerActionButton,
                  d.composerSortButton,
                  cardPickerLoading && s.cardPickerActionDisabled,
                ]}
                onPress={confirmCardPicker}
                disabled={cardPickerLoading}
              >
                <Text style={[s.composerFooterButtonText, { color: colors.white }]}>{t('common.done', { defaultValue: '完成' })}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <BottomSheetModal
        visible={groupSheetVisible}
        onClose={closeGroupSheet}
        backdropStyle={d.groupSheetBackdrop}
        sheetStyle={s.groupSheetWrap}
      >
        <View
          style={[
            s.groupSheet,
            d.groupSheet,
            { paddingBottom: insets.bottom || Spacing.lg },
          ]}
        >
          <View style={[s.groupSheetHandle, d.groupSheetHandle]} />
          <Text style={[s.groupSheetTitle, d.groupSheetTitle]}>
            {t('notes.groupPicker.title', { defaultValue: '选择分组' })}
          </Text>
          {availableGroups.length === 0 ? (
            <Text style={[s.groupSheetEmpty, d.groupSheetRowMeta]}>
              {t('notes.groupPicker.empty', { defaultValue: '暂无分组' })}
            </Text>
          ) : (
            <ScrollView
              style={s.groupSheetList}
              contentContainerStyle={s.groupSheetListContent}
              showsVerticalScrollIndicator={false}
            >
              {availableGroups.map((group) => {
                const selected = selectedGroupIds.includes(group.id);
                return (
                  <Pressable
                    key={group.id}
                    style={[s.groupSheetRow, d.groupSheetRow]}
                    onPress={() => toggleGroup(group.id)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={group.name}
                    accessibilityState={{ checked: selected }}
                  >
                    <View style={s.groupSheetRowTextWrap}>
                      <Text style={[s.groupSheetRowText, d.groupSheetRowText]} numberOfLines={1}>
                        {group.name}
                      </Text>
                      <Text style={[s.groupSheetRowMeta, d.groupSheetRowMeta]}>
                        {t('notes.manageGroups.noteCount', {
                          count: group.noteCount,
                          defaultValue: `${group.noteCount} 条笔记`,
                        })}
                      </Text>
                    </View>
                    <Ionicons
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={selected ? colors.iconAccent : colors.textSecondary}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {groupCreateOpen ? (
            <View style={s.groupCreateRow}>
              <TextInput
                ref={groupCreateInputRef}
                style={[
                  s.groupCreateInput,
                  {
                    color: colors.text,
                    borderColor: colors.surfaceBorder,
                    backgroundColor: colors.background,
                  },
                ]}
                placeholder={t('notes.manageGroups.namePlaceholder', {
                  defaultValue: '输入分组名添加新的分组',
                })}
                placeholderTextColor={colors.textSecondary}
                value={groupCreateName}
                onChangeText={setGroupCreateName}
                maxLength={GROUP_NAME_MAX_LENGTH}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void handleCreateGroup()}
              />
              <Pressable
                style={[
                  s.groupCreateConfirm,
                  d.groupSheetDone,
                  groupCreating ? s.groupCreateDisabled : null,
                ]}
                onPress={() => void handleCreateGroup()}
                disabled={groupCreating}
                accessibilityRole="button"
              >
                <Text style={[s.groupSheetDoneText, d.groupSheetDoneText]}>
                  {groupCreating
                    ? t('notes.groupPicker.saving', { defaultValue: '保存中...' })
                    : t('common.confirm', { defaultValue: '确认' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[s.groupCreateButton, { borderColor: colors.surfaceBorder }]}
              onPress={openGroupCreate}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={colors.iconAccent} />
              <Text style={[s.groupCreateButtonText, { color: colors.iconAccent }]}>
                {t('notes.manageGroups.createNew', { defaultValue: '新增分组' })}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={[s.groupSheetDone, d.groupSheetDone]}
            onPress={closeGroupSheet}
            accessibilityRole="button"
          >
            <Text style={[s.groupSheetDoneText, d.groupSheetDoneText]}>
              {t('common.done', { defaultValue: '完成' })}
            </Text>
          </Pressable>
        </View>
      </BottomSheetModal>
    </KeyboardAvoidingContainer>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    height: 60,
    gap: Spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'left',
    ...Typography.h3,
    fontWeight: '700',
  },
  doneBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  doneBtnText: { ...Typography.body, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: Spacing.sm, gap: Spacing.xs },
  heroCard: {
    marginHorizontal: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.xxl,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  titleInput: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: 2,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  dateText: { ...Typography.caption },
  metaIcon: {
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  groupButton: {
    minHeight: 56,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  groupButtonTextWrap: { flex: 1, gap: 2 },
  groupButtonText: { ...Typography.body, fontWeight: '600' },
  groupButtonSummary: { ...Typography.small },
  groupSheetWrap: { width: '100%', maxHeight: '70%' },
  groupSheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  groupSheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
  },
  groupSheetTitle: { ...Typography.h3, fontWeight: '700' },
  groupSheetList: { maxHeight: 360 },
  groupSheetListContent: { gap: Spacing.xs, paddingBottom: Spacing.xs },
  groupSheetRow: {
    minHeight: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  groupSheetRowTextWrap: { flex: 1, minWidth: 0 },
  groupSheetRowText: { ...Typography.body, fontWeight: '600' },
  groupSheetRowMeta: { ...Typography.small, marginTop: 2 },
  groupSheetEmpty: { ...Typography.small, paddingVertical: Spacing.md },
  groupCreateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  groupCreateInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    ...Typography.bodyRegular,
  },
  groupCreateConfirm: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCreateDisabled: { opacity: 0.55 },
  groupCreateButton: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  groupCreateButtonText: { ...Typography.bodyRegular, fontWeight: '600' },
  cardPickerBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cardPickerSheet: {
    flexShrink: 1,
    maxHeight: '84%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  cardPickerSearchWrap: {
    height: 50,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardPickerSearch: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingVertical: 0,
    textAlignVertical: 'center',
    ...Typography.bodyRegular,
  },
  cardPickerList: {
    maxHeight: 420,
    minHeight: 0,
    flexGrow: 0,
    flexShrink: 1,
  },
  cardPickerListContent: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  cardPickerLoading: {
    alignSelf: 'center',
    marginVertical: Spacing.xl,
  },
  cardPickerEmpty: {
    ...Typography.small,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  cardPickerRow: {
    minHeight: 72,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  cardPickerCheck: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPickerActions: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'stretch',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  cardPickerActionButton: {
    width: 0,
    flexBasis: 0,
    maxWidth: '100%',
    minHeight: 48,
    borderRadius: Radius.lg,
  },
  cardPickerActionDisabled: { opacity: 0.5 },
  groupSheetDone: {
    minHeight: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSheetDoneText: { ...Typography.body, fontWeight: '600' },
  sectionBlock: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
    borderCurve: 'continuous',
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  secondarySection: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 30,
  },
  sectionIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeading: {
    flex: 1,
    // 与详情页小节标题同档（h3/700），编辑页分段更醒目。
    ...Typography.h3,
    fontWeight: '700',
  },
  sectionSubtitle: { ...Typography.small },
  sectionHeaderMeta: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
  },
  sectionHeaderMetaText: { ...Typography.small },
  sectionRemoveButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.xs,
  },
  textEditorFrame: {
    height: 280,
    minHeight: 280,
    overflow: 'hidden',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
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
    borderWidth: 0,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
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
  mediaAddTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderStyle: 'dashed',
  },
  mediaAddLabel: {
    ...Typography.tiny,
    textAlign: 'center',
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
  audioList: { gap: Spacing.xs, marginTop: Spacing.sm },
  audioRow: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardRow: {
    minHeight: 44,
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardRowAvatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
  },
  cardRowAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPickerAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
  },
  cardPickerAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  composerFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingBottom: 6,
    gap: Spacing.xs,
  },
  composerToolbar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  composerTool: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    minHeight: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: 2,
    paddingVertical: Spacing.xs,
  },
  composerToolIcon: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerToolLabel: {
    ...Typography.tinyRegular,
    lineHeight: 14,
    includeFontPadding: false,
    textAlign: 'center',
  },
  composerSortRow: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  composerSortSheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    maxHeight: '78%',
  },
  composerSortHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  composerSortHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  composerSortTitle: { ...Typography.h3 },
  composerSortList: {
    maxHeight: 420,
  },
  composerSortListRow: {
    minHeight: COMPOSER_SORT_ROW_HEIGHT,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  composerSortIndex: {
    width: 24,
    ...Typography.small,
    textAlign: 'center',
  },
  composerSortRowLabel: {
    flex: 1,
    ...Typography.body,
    fontWeight: '600',
  },
  composerSortDragHandle: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerSortEmpty: {
    ...Typography.body,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  composerSortChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
    minHeight: 32,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  composerSortLabel: { ...Typography.tinyRegular },
  composerFooterActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
  },
  composerFooterButton: {
    flex: 1,
    maxWidth: 164,
    minHeight: 40,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  composerFooterButtonText: { ...Typography.body, fontWeight: '700' },
  previewRoot: { flex: 1 },
  previewLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewHeader: {
    minHeight: 56,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
});
