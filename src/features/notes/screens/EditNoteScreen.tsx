import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LogBox,
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
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

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

        blocksRef.current = textBlocks;
        setInitialBlocks(textBlocks.length > 0 ? textBlocks : null);
        setMediaItems(normalizeSectionMedia(note.sections?.media?.items ?? note.media));
        setShowcaseItems(
          normalizeSectionMedia(
            note.sections?.showcase?.items ??
              legacyInlineMedia.filter((item) => item.type === 'IMAGE'),
          ),
        );
        setLocationDraft(buildLocationDraft(note.sections?.location));
        setSelectedGroupIds(note.groups.map((group) => group.id));
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
        });

        await uploadLocalFileToPresignedUrl(
          presign.uploadUrl,
          contentType,
          asset.uri,
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
        if (__DEV__) {
          console.warn('[EditNoteScreen] section media upload failed', error);
        }
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
      Alert.alert('权限不足', '请在系统设置开启定位权限');
      return;
    }
    try {
      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      let title = '当前位置';
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
      Alert.alert('定位失败', '请稍后重试');
    }
  }, []);

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
        status: 'ACTIVE' as const,
      };
      if (isEdit && id) {
        await updateNote(id, input);
      } else {
        await createNote(input);
      }
      navigateBack();
    } catch (error) {
      setIsSubmitting(false);
      const fallback = t('notes.edit.saveFailedMessage', {
        defaultValue: '保存失败，请稍后重试',
      });
      const message = error instanceof Error ? error.message : fallback;
      Alert.alert(
        t('notes.edit.saveFailedTitle', { defaultValue: '保存失败' }),
        message,
      );
      if (__DEV__) {
        console.warn('[EditNoteScreen] save failed', error);
      }
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
      groupChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      groupChipText: { color: colors.textSecondary },
      groupChipTextActive: { color: colors.white },
      sectionTitle: { color: colors.textSecondary },
      sectionHeading: { color: colors.text },
      sectionSubtitle: { color: colors.textSecondary },
      sectionDivider: { borderTopColor: colors.surfaceBorder },
      mediaRow: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      mediaTitle: { color: colors.text },
      mediaMeta: { color: colors.textSecondary },
      emptyText: { color: colors.textSecondary },
      sectionAction: { borderColor: colors.surfaceBorder },
      sectionActionText: { color: colors.text },
      locationInput: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        color: colors.text,
      },
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

  const renderSectionHeader = (
    icon: keyof typeof Ionicons.glyphMap,
    sectionTitle: string,
    subtitle?: string,
  ) => (
    <View style={s.sectionHeader}>
      <View style={s.sectionHeaderIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={s.sectionHeaderText}>
        <Text style={[s.sectionHeading, d.sectionHeading]}>{sectionTitle}</Text>
        {subtitle ? (
          <Text style={[s.sectionSubtitle, d.sectionSubtitle]}>{subtitle}</Text>
        ) : null}
      </View>
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
        <Text style={[s.emptySectionText, d.emptyText]}>
          {t('notes.edit.emptySection', { defaultValue: '暂无内容' })}
        </Text>
      );
    }
    return (
      <View style={s.mediaList}>
        {items.map((item) => (
          <View key={`${item.objectKey}:${item.url}`} style={[s.mediaRow, d.mediaRow]}>
            <View style={s.mediaIconBox}>
              <Ionicons
                name={item.type === 'VIDEO' ? 'videocam-outline' : 'image-outline'}
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={s.mediaInfo}>
              <Text style={[s.mediaTitle, d.mediaTitle]} numberOfLines={1}>
                {item.type === 'VIDEO'
                  ? t('notes.edit.videoItem', { defaultValue: '视频' })
                  : t('notes.edit.imageItem', { defaultValue: '图片' })}
              </Text>
              <Text style={[s.mediaMeta, d.mediaMeta]} numberOfLines={1}>
                {item.mimeType ?? item.url}
              </Text>
            </View>
            <Pressable
              onPress={() => handleRemoveSectionMedia(target, item.url)}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
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

        <View style={[s.sectionBlock, d.sectionDivider]}>
          {renderSectionHeader(
            'text-outline',
            t('notes.edit.sections.text', { defaultValue: '文字' }),
            t('notes.edit.sections.textHint', { defaultValue: '只编辑文字内容' }),
          )}
          <View style={s.textEditorFrame}>
            {editorMounted ? (
              <NoteBlockEditor
                initialContent={initialBlocks}
                onContentChange={handleContentChange}
                mediaToolbarEnabled={false}
              />
            ) : null}
          </View>
        </View>

        <View style={[s.sectionBlock, d.sectionDivider]}>
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

        <View style={[s.sectionBlock, d.sectionDivider]}>
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

        <View style={[s.sectionBlock, d.sectionDivider]}>
          {renderSectionHeader(
            'location-outline',
            t('notes.edit.sections.location', { defaultValue: '地址' }),
            t('notes.edit.sections.locationHint', { defaultValue: '填写位置名称和地址' }),
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
          {locationDraft.latitude != null && locationDraft.longitude != null ? (
            <Text style={[s.locationCoords, d.sectionSubtitle]}>
              {locationDraft.latitude.toFixed(5)}, {locationDraft.longitude.toFixed(5)}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
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
    borderRadius: 6,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 5,
  },
  groupChipActive: { borderWidth: 1 },
  groupChipText: { ...Typography.small, fontWeight: '600' },
  sectionBlock: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  sectionHeaderIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderText: { flex: 1, gap: 2 },
  sectionHeading: { ...Typography.h3, fontWeight: '700' },
  sectionSubtitle: { ...Typography.small },
  textEditorFrame: {
    height: 300,
    minHeight: 300,
    overflow: 'hidden',
    borderRadius: Radius.sm,
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
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    gap: Spacing.xs,
  },
  sectionActionText: { ...Typography.small, fontWeight: '700' },
  mediaList: { gap: Spacing.sm },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 9,
    gap: Spacing.sm,
  },
  mediaIconBox: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaInfo: { flex: 1, minWidth: 0 },
  mediaTitle: { ...Typography.caption, fontWeight: '700' },
  mediaMeta: { ...Typography.small },
  emptySectionText: { ...Typography.small },
  locationInputs: { gap: Spacing.sm },
  locationInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 10,
    ...Typography.body,
  },
  locationCoords: { ...Typography.small },
});
