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
import { Image } from 'expo-image';
import { NoteBlockRenderer } from '@/features/notes/components/NoteBlockRenderer';
import type { NoteDetail, NoteExportFormat } from '@/features/notes/types';
import { extractPlainText } from '@/features/notes/utils/note-blocks';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { getChatDetailHref } from '@/features/user/utils/routes';
import {
  buildNoteSections,
  getInitialNoteSection,
  getNoteSectionAvailability,
  type NoteSectionKind,
} from '@/features/notes/utils/note-sections';
import { createNoteExport, fetchNoteDetail } from '@/services/api/notes';
import { getApiErrorMessage } from '@/services/api/errors';
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
  // hasText 只看结构存在与否：只有空段落的正文也会算 true，渲染出一个
  // 光秃秃的眉标。这里再确认真的有可见内容（文字，或旧数据遗留的行内媒体块）。
  const textSectionHasContent = useMemo(() => {
    if (!sections) return false;
    if (sections.text.content?.trim() || note?.content?.trim()) return true;
    const blocks = sections.text.contentJson;
    if (!Array.isArray(blocks) || blocks.length === 0) return false;
    return (
      blocks.some((block) => block.type === 'image' || block.type === 'video') ||
      extractPlainText(blocks).trim().length > 0
    );
  }, [note?.content, sections]);
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
    [exporting, note, t],
  );

  const canEditNote = useMemo(() => {
    if (!note) return false;
    if (typeof note.canEdit === 'boolean') return note.canEdit;
    const resolvedOwnerId = note.ownerId ?? ownerId;
    return Boolean(resolvedOwnerId && currentUserId === resolvedOwnerId);
  }, [currentUserId, note, ownerId]);

  // 收藏来的笔记 → 来源名片：群聊展示群名片（附分享人），私聊展示对方名片。
  // 名片是收藏者的私人定位标记：转发出去的笔记不带它，别人打开也不渲染
  // （后端只对笔记主人返回 collectedFrom，这里再按归属兜一层）。
  // 后端快照缺关键字段（历史坏数据）时整卡不渲染，避免点了跳不动。
  const collectedSource = useMemo(() => {
    if (!canEditNote) return null;
    const from = note?.collectedFrom;
    if (!from?.conversationID || !from.clientMsgID) return null;
    const isGroup = from.conversationType === 'group';
    const peer = isGroup ? from.group : from.sender;
    if (!peer?.id || !peer.name) return null;
    const subtitle = isGroup
      ? [
          t('notes.detail.sourceGroupLabel', { defaultValue: '来自群聊' }),
          from.sender?.name
            ? t('notes.detail.sourceSharedBy', {
                defaultValue: '{{name}} 分享',
                name: from.sender.name,
              })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : t('notes.detail.sourcePrivateLabel', { defaultValue: '来自私聊' });
    return { isGroup, peer, subtitle, from };
  }, [canEditNote, note?.collectedFrom, t]);

  const handleOpenSource = useCallback(() => {
    if (!collectedSource) return;
    const { isGroup, peer, from } = collectedSource;
    // 聊天页固定挂在 messages 栈下打开，searchedMsgID 触发历史定位滚动。
    router.push(
      getChatDetailHref(
        'messages',
        peer.id,
        peer.name,
        peer.faceURL ?? undefined,
        from.conversationID,
        from.clientMsgID,
        isGroup ? 'group' : 'private',
      ),
    );
  }, [collectedSource, router]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      meta: { color: colors.textSecondary },
      // 分组标签：方形深紫实心块 + 白字（用户指定）
      groupTag: { backgroundColor: colors.deepPurple },
      groupTagText: { color: colors.white },
      content: { color: colors.text },
      iconBtn: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      // 来源名片：主色浅底的"提示条"，CTA 用深一档的实心靛蓝更压得住
      sourceCard: { backgroundColor: colors.primaryLight },
      sourceBtn: { backgroundColor: colors.primaryDeep },
      sectionIconChip: { backgroundColor: colors.primaryLight },
      sectionHeading: { color: colors.text },
      divider: { backgroundColor: colors.surfaceBorder },
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

  const showTextSection = Boolean(availability?.hasText && textSectionHasContent);
  const showMediaSection = Boolean(availability?.hasMedia);
  const showShowcaseSection = Boolean(availability?.hasShowcase);

  // 小节章头：主色浅底图标章 + 加粗标签（正文小节不用，直接展开）
  const renderSectionHeader = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
  ) => (
    <View style={s.sectionHeader}>
      <View style={[s.sectionIconChip, d.sectionIconChip]}>
        <Ionicons name={icon} size={15} color={colors.primary} />
      </View>
      <Text style={[s.sectionHeading, d.sectionHeading]}>{label}</Text>
    </View>
  );

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
            onPress={() => setDownloadMenuVisible(true)}
            hitSlop={4}
          >
            <Ionicons name="download-outline" size={18} color={colors.text} />
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
        onContentSizeChange={scrollToRequestedSection}
      >
        {/* Title */}
        <Text style={[s.title, d.title]}>{note.title}</Text>

        {/* Date + groups */}
        <View style={s.metaRow}>
          <Text style={[s.meta, d.meta]}>{formatNoteFullDate(note.createdAt, t)}</Text>
          {note.groups.length > 0 ? (
            <Text style={[s.meta, d.meta]}>·</Text>
          ) : null}
          {note.groups.map((group) => (
            <View key={group.id} style={[s.groupTag, d.groupTag]}>
              <Text style={[s.groupTagText, d.groupTagText]}>{group.name}</Text>
            </View>
          ))}
        </View>

        {/* 收藏来源名片：主色浅底提示条，点击/CTA 跳回聊天定位到分享消息 */}
        {collectedSource ? (
          <Pressable
            style={[s.sourceCard, d.sourceCard]}
            onPress={handleOpenSource}
            accessibilityRole="button"
            accessibilityLabel={t('notes.detail.sourceLocate', {
              defaultValue: '查看原消息',
            })}
          >
            {collectedSource.peer.faceURL ? (
              <Image
                source={{ uri: collectedSource.peer.faceURL }}
                style={s.sourceAvatar}
                contentFit="cover"
              />
            ) : (
              <View style={[s.sourceAvatar, { backgroundColor: colors.primary }]}>
                <Ionicons
                  name={collectedSource.isGroup ? 'people' : 'person'}
                  size={20}
                  color={colors.white}
                />
              </View>
            )}
            <View style={s.sourceCardText}>
              <Text
                style={[s.sourceCardName, { color: colors.text }]}
                numberOfLines={1}
              >
                {collectedSource.peer.name}
              </Text>
              <Text style={[s.sourceSubtitle, d.meta]} numberOfLines={1}>
                {`↳ ${collectedSource.subtitle}`}
              </Text>
            </View>
            <View style={[s.sourceBtn, d.sourceBtn]}>
              <Text style={[s.sourceBtnText, { color: colors.white }]}>
                {t('notes.detail.sourceLocate', { defaultValue: '查看原消息' })}
              </Text>
              <Ionicons name="chevron-forward" size={12} color={colors.white} />
            </View>
          </Pressable>
        ) : null}

        {sections ? (
          <>
            {/* 正文是主角：不加眉标，直接展开（设计稿） */}
            {showTextSection ? (
              <View onLayout={trackSectionLayout('text')} style={s.section}>
                {sections.text.contentJson && sections.text.contentJson.length > 0 ? (
                  <NoteBlockRenderer blocks={sections.text.contentJson} />
                ) : sections.text.content || note.content ? (
                  <Text style={[s.bodyText, d.content]}>
                    {sections.text.content || note.content}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {showMediaSection ? (
              <View onLayout={trackSectionLayout('media')} style={s.section}>
                {showTextSection ? (
                  <View style={[s.divider, d.divider]} />
                ) : null}
                {renderSectionHeader(
                  'image-outline',
                  t('notes.section.media', { defaultValue: '图片 · 视频' }),
                )}
                <NoteBlockRenderer
                  blocks={sections.media.items.map((item) => ({
                    id: item.id ?? item.url,
                    type: item.type === 'VIDEO' ? 'video' : 'image',
                    props: {
                      url: item.url,
                      caption: '',
                      width: item.width ?? undefined,
                      height: item.height ?? undefined,
                    },
                  }))}
                />
              </View>
            ) : null}

            {showShowcaseSection ? (
              <View onLayout={trackSectionLayout('showcase')} style={s.section}>
                {showTextSection || showMediaSection ? (
                  <View style={[s.divider, d.divider]} />
                ) : null}
                {renderSectionHeader(
                  'albums-outline',
                  t('notes.section.showcase', { defaultValue: '展示' }),
                )}
                <NoteBlockRenderer
                  blocks={sections.showcase.items.map((item) => ({
                    id: item.id ?? item.url,
                    type: item.type === 'VIDEO' ? 'video' : 'image',
                    props: {
                      url: item.url,
                      caption: '',
                      width: item.width ?? undefined,
                      height: item.height ?? undefined,
                    },
                  }))}
                />
              </View>
            ) : null}

            {availability?.hasLocation ? (
              <View onLayout={trackSectionLayout('location')} style={s.section}>
                {showTextSection || showMediaSection || showShowcaseSection ? (
                  <View style={[s.divider, d.divider]} />
                ) : null}
                {renderSectionHeader(
                  'location-outline',
                  t('notes.section.location', { defaultValue: '地址' }),
                )}
                <View style={s.locationRow}>
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
  // 详情页的"刊头"：标题是唯一的重型元素，其余信息全部退为次级。
  title: { ...Typography.title, lineHeight: 40, marginBottom: Spacing.sm },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  meta: { ...Typography.caption, fontWeight: '400' },
  groupTag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.xs,
  },
  groupTagText: { ...Typography.small, fontWeight: '600' },
  bodyText: { ...Typography.bodyRegular, fontSize: 15, lineHeight: 26 },
  // 来源名片（设计稿）：主色浅底 + 方圆角头像 + 实心主色 CTA 胶囊
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 4,
    borderRadius: Radius.lg,
    padding: Spacing.sm + 4,
    marginBottom: Spacing.lg,
  },
  sourceAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sourceCardText: { flex: 1, gap: 2 },
  sourceCardName: { ...Typography.body, fontWeight: '600' },
  sourceSubtitle: { ...Typography.small },
  sourceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 32,
    paddingHorizontal: Spacing.sm + 4,
    borderRadius: Radius.full,
  },
  sourceBtnText: { ...Typography.small, fontWeight: '600' },
  // 小节之间用分隔线 + 图标章头分段，正文不设头直接展开（设计稿）。
  // 1pt 实线：发丝线在真机上太淡，分段感立不住。
  section: { gap: Spacing.md - 4, marginBottom: Spacing.lg },
  divider: { height: 1, marginBottom: Spacing.md - 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
  },
  sectionIconChip: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeading: { ...Typography.h3, fontWeight: '700' },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
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
