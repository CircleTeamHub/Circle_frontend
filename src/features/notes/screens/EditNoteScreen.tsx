import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LogBox,
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
import { useNoteLocationPickerStore } from '@/features/notes/store/use-note-location-picker-store';
import type { CreateNoteMediaInput, NoteGroup, NoteSections } from '@/features/notes/types';
import {
  buildNoteMediaMap,
  extractMediaFromBlocks,
  extractPlainText,
  mergeExtractedMediaWithMediaMap,
} from '@/features/notes/utils/note-blocks';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { getNoteVideoUploadPolicyViolation } from '@/features/notes/utils/note-media-policy';
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

function buildMapPreviewUrl(latitude: number, longitude: number) {
  const center = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(center)}&zoom=15&size=640x260&markers=${encodeURIComponent(`${center},red-pushpin`)}`;
}

function getTextOnlyBlocks(blocks: Record<string, unknown>[]) {
  return blocks.filter((block) => block.type !== 'image' && block.type !== 'video');
}

function normalizeSectionMedia(
  items:
    | (CreateNoteMediaInput | NoteSections['media']['items'][number])[]
    | undefined,
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
    .map((item, index): CreateNoteMediaInput => ({
      type: item.type,
      objectKey: item.objectKey,
      url: item.url,
      ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
      ...(typeof item.width === 'number' ? { width: item.width } : {}),
      ...(typeof item.height === 'number' ? { height: item.height } : {}),
      ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
      ...(typeof item.posterUrl === 'string' ? { posterUrl: item.posterUrl } : {}),
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
    }));
}

function hasSectionMediaItems(
  items: NoteSections['media']['items'] | NoteSections['showcase']['items'] | undefined,
) {
  return Array.isArray(items);
}

function mergeMedia(items: CreateNoteMediaInput[]) {
  return items.reduce<CreateNoteMediaInput[]>((merged, item) => {
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
  const { colors } = useTheme();
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
  const [dateStr, setDateStr] = useState(() =>
    formatNoteFullDate(new Date().toISOString(), t),
  );
  const existingSectionsRef = useRef<Partial<NoteSections> | null>(null);
  const uploadInFlightRef = useRef(false);
  const [editorMounted, setEditorMounted] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [mediaItems, setMediaItems] = useState<CreateNoteMediaInput[]>([]);
  const [showcaseItems, setShowcaseItems] = useState<CreateNoteMediaInput[]>([]);
  const [uploadingSection, setUploadingSection] = useState<UploadingSection>(null);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>({
    title: '',
    address: '',
    latitude: null,
    longitude: null,
  });
  const consumePickedLocation = useNoteLocationPickerStore(
    (state) => state.consumePickedLocation,
  );

  useEffect(() => {
    if (!navigating) return;
    const timer = setTimeout(() => router.back(), 200);
    return () => clearTimeout(timer);
  }, [navigating, router]);

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
      setMediaItems([]);
      setShowcaseItems([]);
      setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
      setEditorMounted(true);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    fetchNoteDetail(id)
      .then((note) => {
        if (cancelled) return;
        setTitle(note.title);
        existingSectionsRef.current = note.sections ?? null;

        const loaded = note.sections?.text?.contentJson ?? note.contentJson ?? [];
        const textBlocks = getTextOnlyBlocks(loaded);
        const noteMediaMap = buildNoteMediaMap(note.media);
        const legacyInlineMedia = mergeExtractedMediaWithMediaMap(
          extractMediaFromBlocks(loaded),
          noteMediaMap,
        );
        const hasExplicitMedia = hasSectionMediaItems(note.sections?.media?.items);
        const hasExplicitShowcase = hasSectionMediaItems(note.sections?.showcase?.items);

        blocksRef.current = textBlocks;
        setInitialBlocks(textBlocks.length > 0 ? textBlocks : null);
        setMediaItems(
          hasExplicitMedia
            ? normalizeSectionMedia(note.sections?.media?.items)
            : hasExplicitShowcase
              ? []
              : normalizeSectionMedia(note.media),
        );
        setShowcaseItems(
          hasExplicitShowcase
            ? normalizeSectionMedia(note.sections?.showcase?.items)
            : hasExplicitMedia
              ? []
              : normalizeSectionMedia(
                  legacyInlineMedia.filter((item) => item.type === 'IMAGE'),
                ),
        );
        setLocationDraft(buildLocationDraft(note.sections?.location));
        setSelectedGroupIds(note.groups.map((group) => group.id));
        pinnedRef.current = note.pinned;
        setDateStr(formatNoteFullDate(note.createdAt, t));
        setLoading(false);
        setEditorMounted(true);
      })
      .catch(() => {
        if (!cancelled) {
          existingSectionsRef.current = null;
          setMediaItems([]);
          setShowcaseItems([]);
          setLocationDraft({ title: '', address: '', latitude: null, longitude: null });
          setLoading(false);
          setEditorMounted(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, isEdit, t]);

  useFocusEffect(
    useCallback(() => {
      const picked = consumePickedLocation();
      if (!picked) return;
      setLocationDraft({
        title: picked.title,
        address: picked.address,
        latitude: picked.latitude,
        longitude: picked.longitude,
      });
    }, [consumePickedLocation]),
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
      if (uploadInFlightRef.current) return;
      uploadInFlightRef.current = true;
      const uploadKey: UploadingSection = `${target}:${kind}`;
      setUploadingSection(uploadKey);
      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return;

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: kind === 'video' ? ['videos'] : ['images'],
          quality: 0.85,
          allowsMultipleSelection: false,
        });
        if (result.canceled || !result.assets.length) return;

        const asset = result.assets[0];
        if (kind === 'video') {
          const violation = getNoteVideoUploadPolicyViolation({
            fileSize: asset.fileSize,
            duration: asset.duration,
          });
          if (violation) {
            Alert.alert(
              t('notes.editor.videoRejectedTitle', {
                defaultValue: '视频无法上传',
              }),
              violation === 'size'
                ? t('notes.editor.videoTooLargeMessage', {
                    defaultValue: '请选择 200MB 以内的视频',
                  })
                : t('notes.editor.videoTooLongMessage', {
                    defaultValue: '请选择 10 分钟以内的视频',
                  }),
            );
            return;
          }
        }

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

        const nextItem: CreateNoteMediaInput = {
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

        if (target === 'media') {
          setMediaItems((current) => [
            ...current,
            { ...nextItem, sortOrder: current.length },
          ]);
        } else {
          setShowcaseItems((current) => [
            ...current,
            { ...nextItem, sortOrder: current.length },
          ]);
        }
      } catch (error) {
        Alert.alert(
          t('notes.editor.mediaUploadFailedTitle', {
            defaultValue: '上传失败',
          }),
          t('notes.editor.mediaUploadFailedMessage', {
            defaultValue: '请稍后重试',
          }),
        );
        reportHandledFailure('noteEditor', 'sectionMediaUpload', error);
      } finally {
        uploadInFlightRef.current = false;
        setUploadingSection(null);
      }
    },
    [t],
  );

  const handleRemoveSectionMedia = useCallback((target: SectionMediaTarget, url: string) => {
    const removeByUrl = (items: CreateNoteMediaInput[]) =>
      items
        .filter((item) => item.url !== url)
        .map((item, index) => ({ ...item, sortOrder: index }));
    if (target === 'media') {
      setMediaItems((current) => removeByUrl(current));
    } else {
      setShowcaseItems((current) => removeByUrl(current));
    }
  }, []);

  const handleOpenLocationPicker = useCallback(() => {
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
    locationDraft.address,
    locationDraft.latitude,
    locationDraft.longitude,
    locationDraft.title,
    router,
  ]);

  const handleUseCurrentLocation = useCallback(async () => {
    const permission = await ExpoLocation.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        t('permissions.insufficientTitle', { defaultValue: '权限不足' }),
        t('permissions.location', { defaultValue: '请在系统设置开启定位权限' }),
      );
      return;
    }
    try {
      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      let title = t('notes.edit.useCurrentLocation', { defaultValue: '当前位置' });
      let address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      try {
        const places = await ExpoLocation.reverseGeocodeAsync({ latitude, longitude });
        const place = places[0];
        if (place) {
          const parts = [
            place.city ?? place.region,
            place.district ?? place.subregion,
            place.street,
            place.name,
          ].filter((part): part is string => Boolean(part));
          if (parts.length) {
            title = parts.at(-1) ?? title;
            address = parts.join(' ');
          }
        }
      } catch {
        // Geocoding failure should not block coordinate selection.
      }
      setLocationDraft({ title, address, latitude, longitude });
    } catch {
      Alert.alert(
        t('notes.location.failedTitle', { defaultValue: '定位失败' }),
        t('common.retryLater', { defaultValue: '请稍后重试' }),
      );
    }
  }, [t]);

  const navigateBack = useCallback(() => {
    setEditorMounted(false);
    setNavigating(true);
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setIsSubmitting(true);
    try {
      const currentBlocks = getTextOnlyBlocks(blocksRef.current);
      const plainText = extractPlainText(currentBlocks);
      const sectionMedia = mergeMedia(mediaItems);
      const sectionShowcase = mergeMedia(showcaseItems);
      const legacyMedia = mergeMedia([...sectionMedia, ...sectionShowcase]);
      const nextLocation =
        locationDraft.title.trim() ||
        locationDraft.address.trim() ||
        locationDraft.latitude != null ||
        locationDraft.longitude != null
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
      navigateBack();
    } catch (error) {
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
    isSubmitting,
    locationDraft.address,
    locationDraft.latitude,
    locationDraft.longitude,
    locationDraft.title,
    mediaItems,
    navigateBack,
    selectedGroupIds,
    showcaseItems,
    t,
    title,
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
      locationInput: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        color: colors.text,
      },
      locationPreviewCard: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      locationCoordinatePill: { backgroundColor: colors.background },
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

  const isDoneDisabled = isSubmitting || !title.trim();
  const locationPreviewUrl =
    locationDraft.latitude != null && locationDraft.longitude != null
      ? buildMapPreviewUrl(locationDraft.latitude, locationDraft.longitude)
      : null;

  // 眉标式小节头：图标 + 标签 + 右侧计数，去掉解释性副标题让内容当主角。
  const renderSectionHeader = (
    icon: keyof typeof Ionicons.glyphMap,
    sectionTitle: string,
    meta?: string,
  ) => (
    <View style={s.sectionHeader}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={[s.sectionHeading, d.sectionHeading]}>{sectionTitle}</Text>
      {meta ? (
        <Text style={[s.sectionHeaderMeta, d.sectionHeaderMeta]}>{meta}</Text>
      ) : null}
    </View>
  );

  const renderAddButton = (
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
        disabled={uploadingSection !== null}
      >
        <Ionicons name={icon} size={17} color={colors.text} />
        <Text style={[s.sectionActionText, d.sectionActionText]}>
          {uploadingSection === uploadKey ? loadingLabel : label}
        </Text>
      </Pressable>
    );
  };

  const renderMediaList = (items: CreateNoteMediaInput[], target: SectionMediaTarget) => {
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
          const thumbUri = item.type === 'IMAGE' ? item.url : item.posterUrl;
          return (
            <View
              key={`${item.objectKey}:${item.url}`}
              style={[s.mediaPreviewTile, d.mediaPreviewTile]}
            >
              {thumbUri ? (
                <Image source={{ uri: thumbUri }} style={s.mediaThumb} contentFit="cover" />
              ) : (
                <View style={s.mediaThumbFallback}>
                  <Ionicons
                    name={item.type === 'VIDEO' ? 'videocam-outline' : 'image-outline'}
                    size={24}
                    color={colors.primary}
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
                onPress={() => handleRemoveSectionMedia(target, item.url)}
                hitSlop={8}
              >
                <Ionicons name="close" size={15} color={colors.text} />
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  };

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

        <View style={[s.sectionBlock, d.sectionShell]}>
          {renderSectionHeader(
            'images-outline',
            t('notes.edit.sections.media', { defaultValue: '图片/视频' }),
            `${mediaItems.length} ${t('notes.edit.itemsCount', { defaultValue: '项' })}`,
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
            `${showcaseItems.length} ${t('notes.edit.itemsCount', { defaultValue: '项' })}`,
          )}
          <View style={s.sectionActions}>
            {renderAddButton(
              'showcase',
              'image',
              t('notes.edit.addShowcaseImage', { defaultValue: '添加展示图片' }),
              'image-outline',
            )}
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
            t('notes.edit.sections.location', { defaultValue: '地址' }),
            locationPreviewUrl
              ? t('notes.edit.sections.locationSelected', { defaultValue: '已选择' })
              : t('notes.edit.sections.locationEmpty', { defaultValue: '可选' }),
          )}
          <View style={s.sectionActions}>
            <Pressable
              style={[s.sectionAction, d.sectionAction]}
              onPress={handleOpenLocationPicker}
            >
              <Ionicons name="map-outline" size={17} color={colors.text} />
              <Text style={[s.sectionActionText, d.sectionActionText]}>
                {t('notes.edit.pickLocation', { defaultValue: '选择位置' })}
              </Text>
            </Pressable>
            <Pressable
              style={[s.sectionAction, d.sectionAction]}
              onPress={() => void handleUseCurrentLocation()}
            >
              <Ionicons name="navigate-outline" size={17} color={colors.text} />
              <Text style={[s.sectionActionText, d.sectionActionText]}>
                {t('notes.edit.useCurrentLocation', { defaultValue: '当前位置' })}
              </Text>
            </Pressable>
          </View>
          <View style={s.locationInputs}>
            <TextInput
              style={[s.locationInput, d.locationInput]}
              placeholder={t('notes.edit.locationTitlePlaceholder', {
                defaultValue: '位置名称',
              })}
              placeholderTextColor={colors.textSecondary}
              value={locationDraft.title}
              onChangeText={(value) =>
                setLocationDraft((current) => ({ ...current, title: value }))
              }
              maxLength={80}
              returnKeyType="next"
            />
            <TextInput
              style={[s.locationInput, d.locationInput]}
              placeholder={t('notes.edit.locationAddressPlaceholder', {
                defaultValue: '地址',
              })}
              placeholderTextColor={colors.textSecondary}
              value={locationDraft.address}
              onChangeText={(value) =>
                setLocationDraft((current) => ({ ...current, address: value }))
              }
              maxLength={160}
              returnKeyType="done"
            />
          </View>
          {locationPreviewUrl ? (
            <View style={[s.locationPreviewCard, d.locationPreviewCard]}>
              <Image
                source={{ uri: locationPreviewUrl }}
                style={s.locationMapPreview}
                contentFit="cover"
              />
              <View style={s.locationPreviewInfo}>
                <View style={s.locationPreviewTitleRow}>
                  <Ionicons name="location" size={16} color={colors.primary} />
                  <Text style={[s.mediaTitle, d.mediaTitle]} numberOfLines={1}>
                    {locationDraft.title ||
                      t('notes.edit.locationPreviewTitle', {
                        defaultValue: '已选择位置',
                      })}
                  </Text>
                </View>
                {locationDraft.address ? (
                  <Text style={[s.mediaMeta, d.mediaMeta]} numberOfLines={2}>
                    {locationDraft.address}
                  </Text>
                ) : null}
                <View style={[s.locationCoordinatePill, d.locationCoordinatePill]}>
                  <Text style={[s.locationCoords, d.sectionSubtitle]} selectable>
                    {locationDraft.latitude?.toFixed(5)}, {locationDraft.longitude?.toFixed(5)}
                  </Text>
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
  locationInputs: { gap: Spacing.sm },
  locationInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    ...Typography.body,
    fontWeight: '400',
  },
  locationPreviewCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  locationMapPreview: {
    width: '100%',
    height: 126,
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
  locationCoordinatePill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  locationCoords: { ...Typography.small },
});
