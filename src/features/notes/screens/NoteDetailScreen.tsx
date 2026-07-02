import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteBlockRenderer } from '@/features/notes/components/NoteBlockRenderer';
import type { NoteDetail, NoteExportFormat } from '@/features/notes/types';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import {
  buildNoteSections,
  getInitialNoteSection,
  getNoteSectionAvailability,
  type NoteSectionKind,
} from '@/features/notes/utils/note-sections';
import { createNoteExport, fetchNoteDetail } from '@/services/api/notes';
import { ApiError } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export default function NoteDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { id, ownerId, section } = useLocalSearchParams<{
    id: string;
    ownerId?: string;
    section?: string;
  }>();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<NoteExportFormat | null>(null);
  const [downloadMenuVisible, setDownloadMenuVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sectionYRef = useRef<Partial<Record<NoteSectionKind, number>>>({});
  const scrolledSectionRef = useRef<string | null>(null);

  const loadNote = useCallback(() => {
    if (!id) {
      setLoading(false);
      return () => undefined;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchNoteDetail(id)
      .then((data) => {
        if (cancelled) return;
        setNote(data);
        setLoading(false);
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
          if (__DEV__) {
            console.warn('[NoteDetailScreen] fetchNoteDetail failed', error);
          }
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  useEffect(() => loadNote(), [loadNote]);

  const handleEdit = useCallback(() => {
    if (!note) return;
    router.push(`/(tabs)/profile/notes/edit?id=${note.id}` as never);
  }, [router, note]);

  const sections = useMemo(() => (note ? buildNoteSections(note) : null), [note]);
  const availability = useMemo(
    () => (sections ? getNoteSectionAvailability(sections) : null),
    [sections],
  );
  const targetSection = useMemo(
    () => (sections ? getInitialNoteSection(section, sections) : null),
    [section, sections],
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
        const result = await createNoteExport(note.id, {
          format,
          scope: 'ALL',
        });
        await Share.share({
          url: result.url,
          message: result.url,
          title: result.filename,
        });
        setDownloadMenuVisible(false);
      } catch (error) {
        Alert.alert(
          t('notes.detail.exportFailedTitle', { defaultValue: '导出失败' }),
          error instanceof Error
            ? error.message
            : t('notes.detail.exportFailedMessage', {
                defaultValue: '请稍后重试',
              }),
        );
      } finally {
        setExporting(null);
      }
    },
    [exporting, note, t],
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
      title: { color: colors.text },
      meta: { color: colors.textSecondary },
      groupTag: { backgroundColor: colors.primary + '33' },
      groupTagText: { color: colors.primary },
      content: { color: colors.text },
      sectionTitle: { color: colors.text },
      sectionCard: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
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
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={s.headerActions}>
          <Pressable onPress={() => setDownloadMenuVisible(true)} hitSlop={8}>
            <Ionicons name="download-outline" size={22} color={colors.text} />
          </Pressable>
          {canEditNote ? (
            <Pressable onPress={handleEdit} hitSlop={8}>
              <Ionicons name="create-outline" size={22} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={scrollToRequestedSection}
      >
        {/* Title */}
        <Text style={[s.title, d.title]}>{note.title}</Text>

        {/* Date + groups */}
        <View style={s.metaRow}>
          <Text style={[s.meta, d.meta]}>{formatNoteFullDate(note.createdAt, t)}</Text>
          {note.groups.map((group) => (
            <View key={group.id} style={[s.groupTag, d.groupTag]}>
              <Text style={[s.groupTagText, d.groupTagText]}>{group.name}</Text>
            </View>
          ))}
        </View>

        {sections ? (
          <>
            {availability?.hasText ? (
              <View onLayout={trackSectionLayout('text')} style={s.section}>
                <Text style={[s.sectionTitle, d.sectionTitle]}>
                  {t('notes.section.text', { defaultValue: '文字' })}
                </Text>
                {sections.text.contentJson && sections.text.contentJson.length > 0 ? (
                  <NoteBlockRenderer blocks={sections.text.contentJson} />
                ) : sections.text.content || note.content ? (
                  <Text style={[s.bodyText, d.content]}>
                    {sections.text.content || note.content}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {availability?.hasMedia ? (
              <View onLayout={trackSectionLayout('media')} style={s.section}>
                <Text style={[s.sectionTitle, d.sectionTitle]}>
                  {t('notes.section.media', { defaultValue: '图片 / 视频' })}
                </Text>
                <NoteBlockRenderer
                  blocks={sections.media.items.map((item) => ({
                    id: item.id ?? item.url,
                    type: item.type === 'VIDEO' ? 'video' : 'image',
                    props: { url: item.url, caption: '' },
                  }))}
                />
              </View>
            ) : null}

            {availability?.hasShowcase ? (
              <View onLayout={trackSectionLayout('showcase')} style={s.section}>
                <Text style={[s.sectionTitle, d.sectionTitle]}>
                  {t('notes.section.showcase', { defaultValue: '展示' })}
                </Text>
                <NoteBlockRenderer
                  blocks={sections.showcase.items.map((item) => ({
                    id: item.id ?? item.url,
                    type: item.type === 'VIDEO' ? 'video' : 'image',
                    props: { url: item.url, caption: '' },
                  }))}
                />
              </View>
            ) : null}

            {availability?.hasLocation ? (
              <View onLayout={trackSectionLayout('location')} style={s.section}>
                <Text style={[s.sectionTitle, d.sectionTitle]}>
                  {t('notes.section.location', { defaultValue: '地址' })}
                </Text>
                <View style={[s.locationCard, d.sectionCard]}>
                  <Ionicons name="location-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.locationTitle, { color: colors.text }]}>
                      {sections.location?.title ||
                        t('notes.detail.locationFallback', { defaultValue: '位置' })}
                    </Text>
                    {sections.location?.address ? (
                      <Text style={[s.meta, d.meta]}>{sections.location.address}</Text>
                    ) : null}
                  </View>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

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
    gap: Spacing.md,
    minWidth: 52,
    justifyContent: 'flex-end',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  title: { ...Typography.h1, fontWeight: '700', marginBottom: Spacing.xs },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  meta: { ...Typography.caption },
  groupTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  groupTagText: { ...Typography.small, fontWeight: '600' },
  bodyText: { ...Typography.bodyRegular, lineHeight: 24 },
  section: { gap: Spacing.sm, marginBottom: Spacing.lg },
  sectionTitle: { ...Typography.h2, fontWeight: '700' },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  locationTitle: { ...Typography.body, fontWeight: '600' },
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
