import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { NoteBlockRenderer } from '@/features/notes/components/NoteBlockRenderer';
import {
  getNoteSectionAvailability,
  type NoteSectionKind,
  type NoteSections,
} from '@/features/notes/utils/note-sections';
import { getNoteDocumentInstances, noteMediaBlocks, type NoteDocumentInstance } from '@/features/notes/utils/note-document-layout';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export type NoteDocumentGroup = {
  id: string;
  name: string;
};

type NoteDocumentBodyProps = {
  title: string;
  createdAt: string;
  groups: readonly NoteDocumentGroup[];
  sections: NoteSections;
  order: readonly NoteSectionKind[];
  layout?: unknown;
  onContactPress?: (id: string, name?: string) => void;
  onGroupPress?: (id: string, name?: string) => void;
  onMediaError?: () => void;
  onImagePress?: (uri: string, objectKey?: string) => void;
  lazyMedia?: boolean;
  virtualized?: boolean;
  contentPaddingBottom?: number;
  onSectionLayout?: (kind: NoteSectionKind) => (event: LayoutChangeEvent) => void;
};

type VirtualizedNoteRow =
  | { type: 'section'; id: string; kind: NoteSectionKind; divider: boolean; trackLayout: boolean }
  | { type: 'block'; id: string; block: Record<string, unknown> }
  | { type: 'text'; id: string; content: string | null; empty: boolean }
  | { type: 'location'; id: string; title: string | null; address: string | null }
  | { type: 'spacer'; id: string };

export const NoteDocumentBody = memo(function NoteDocumentBody({
  title,
  createdAt,
  groups,
  sections,
  order,
  layout,
  onContactPress,
  onGroupPress,
  onMediaError,
  onImagePress,
  lazyMedia = false,
  virtualized = false,
  contentPaddingBottom = 0,
  onSectionLayout,
}: NoteDocumentBodyProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const documentInstances = useMemo(() => getNoteDocumentInstances(sections, order, layout), [sections, order, layout]);
  const contactBlocks = useMemo(
    () => sections.contacts.items.map((card, index) => ({
      id: card.id || `contact-${index}`,
      type: 'contact',
      props: card,
    })),
    [sections.contacts.items],
  );
  const groupBlocks = useMemo(
    () => sections.groups.items.map((card, index) => ({
      id: card.id || `group-${index}`,
      type: 'group',
      props: card,
    })),
    [sections.groups.items],
  );

  const virtualizedRows = useMemo<VirtualizedNoteRow[]>(() => {
    const rows: VirtualizedNoteRow[] = [];
    const appendSection = (
      kind: NoteSectionKind,
      instanceId: string,
      blocks: Record<string, unknown>[] = [],
    ) => {
      rows.push({
        type: 'section',
        id: `section-${instanceId}`,
        trackLayout: documentInstances.find((entry) => entry.kind === kind)?.id === instanceId,
        kind,
        divider: kind !== 'text',
      });
      blocks.forEach((block, index) => {
        const blockId = typeof block.id === 'string' ? block.id : String(index);
        rows.push({ type: 'block', id: `block-${instanceId}-${blockId}-${index}`, block });
      });
      rows.push({ type: 'spacer', id: `spacer-${instanceId}` });
    };

    for (const entry of documentInstances) {
      const { kind, sections } = entry;
      const availability = getNoteSectionAvailability(sections);
      const mediaBlocks = noteMediaBlocks(sections.media.items);
      const showcaseBlocks = noteMediaBlocks(sections.showcase.items);
      const audioBlocks = noteMediaBlocks(sections.audio.items);
      switch (kind) {
        case 'text':
          appendSection(kind, entry.id);
          if (availability.hasText && sections.text.contentJson?.length) {
            sections.text.contentJson.forEach((block, index) => {
              const blockId = typeof block.id === 'string' ? block.id : String(index);
              rows.splice(rows.length - 1, 0, {
                type: 'block',
                id: `block-${entry.id}-${blockId}-${index}`,
                block,
              });
            });
          } else {
            rows.splice(rows.length - 1, 0, {
              type: 'text',
              id: `text-${entry.id}`,
              content: availability.hasText ? sections.text.content : null,
              empty: !availability.hasText,
            });
          }
          break;
        case 'media':
          if (availability.hasMedia) appendSection(kind, entry.id, mediaBlocks);
          break;
        case 'showcase':
          if (availability.hasShowcase) appendSection(kind, entry.id, showcaseBlocks);
          break;
        case 'audio':
          if (availability.hasAudio) appendSection(kind, entry.id, audioBlocks);
          break;
        case 'contact':
          if (availability.hasContacts) appendSection(kind, entry.id, contactBlocks);
          break;
        case 'group':
          if (availability.hasGroups) appendSection(kind, entry.id, groupBlocks);
          break;
        case 'location':
          if (availability.hasLocation) {
            appendSection(kind, entry.id);
            rows.splice(rows.length - 1, 0, {
              type: 'location',
              id: `location-${entry.id}`,
              title: sections.location?.title ?? null,
              address: sections.location?.address ?? null,
            });
          }
          break;
        default:
          break;
      }
    }
    return rows;
  }, [contactBlocks, groupBlocks, documentInstances]);

  const renderSectionHeader = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
  ) => (
    <View style={s.sectionHeader}>
      <View style={[s.sectionIconChip, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name={icon} size={15} color={colors.iconAccent} />
      </View>
      <Text style={[s.sectionHeading, { color: colors.text }]}>{label}</Text>
    </View>
  );

  const renderSection = ({ id, kind, sections }: NoteDocumentInstance) => {
    const onLayout = documentInstances.find((entry) => entry.kind === kind)?.id === id ? onSectionLayout?.(kind) : undefined;
    const availability = getNoteSectionAvailability(sections);
    const mediaBlocks = noteMediaBlocks(sections.media.items);
    const showcaseBlocks = noteMediaBlocks(sections.showcase.items);
    const audioBlocks = noteMediaBlocks(sections.audio.items);
    switch (kind) {
      case 'text':
        return (
          <View onLayout={onLayout} style={s.section}>
            {renderSectionHeader(
              'text-outline',
              t('notes.section.text', { defaultValue: '文字' }),
            )}
            {availability.hasText ? (
              sections.text.contentJson && sections.text.contentJson.length > 0 ? (
                <NoteBlockRenderer
                  onContactPress={onContactPress} onGroupPress={onGroupPress}
                  blocks={sections.text.contentJson}
                  onMediaError={onMediaError}
                  onImagePress={onImagePress}
                  lazyMedia={lazyMedia}
                />
              ) : (
                <Text style={[s.bodyText, { color: colors.text }]}>
                  {sections.text.content}
                </Text>
              )
            ) : (
              <Text style={[s.emptyHint, { color: colors.textSecondary }]}>
                {t('notes.section.emptyText', { defaultValue: '暂无文字内容' })}
              </Text>
            )}
          </View>
        );
      case 'media':
        return availability.hasMedia ? (
          <View onLayout={onLayout} style={s.section}>
            <View style={[s.divider, { backgroundColor: colors.surfaceBorder }]} />
            {renderSectionHeader(
              'image-outline',
              t('notes.section.media', { defaultValue: '图片 · 视频' }),
            )}
            <NoteBlockRenderer
              blocks={mediaBlocks}
              onMediaError={onMediaError}
              onImagePress={onImagePress}
              lazyMedia={lazyMedia}
            />
          </View>
        ) : null;
      case 'showcase':
        return availability.hasShowcase ? (
          <View onLayout={onLayout} style={s.section}>
            <View style={[s.divider, { backgroundColor: colors.surfaceBorder }]} />
            {renderSectionHeader(
              'albums-outline',
              t('notes.section.showcase', { defaultValue: '展示' }),
            )}
            <NoteBlockRenderer
              blocks={showcaseBlocks}
              onMediaError={onMediaError}
              onImagePress={onImagePress}
              lazyMedia={lazyMedia}
            />
          </View>
        ) : null;
      case 'audio':
        return availability.hasAudio ? (
          <View onLayout={onLayout} style={s.section}>
            <View style={[s.divider, { backgroundColor: colors.surfaceBorder }]} />
            {renderSectionHeader(
              'mic-outline',
              t('notes.section.audio', { defaultValue: '录音' }),
            )}
            <NoteBlockRenderer blocks={audioBlocks} onMediaError={onMediaError} lazyMedia={lazyMedia} />
          </View>
        ) : null;
      case 'contact':
        return availability.hasContacts ? (
          <View onLayout={onLayout} style={s.section}>
            <View style={[s.divider, { backgroundColor: colors.surfaceBorder }]} />
            {renderSectionHeader(
              'person-outline',
              t('notes.section.contact', { defaultValue: '名片' }),
            )}
            <NoteBlockRenderer blocks={contactBlocks} onContactPress={onContactPress} />
          </View>
        ) : null;
      case 'group':
        return availability.hasGroups ? (
          <View onLayout={onLayout} style={s.section}>
            <View style={[s.divider, { backgroundColor: colors.surfaceBorder }]} />
            {renderSectionHeader(
              'people-outline',
              t('notes.section.group', { defaultValue: '群名片' }),
            )}
            <NoteBlockRenderer blocks={groupBlocks} onGroupPress={onGroupPress} />
          </View>
        ) : null;
      case 'location':
        return availability.hasLocation ? (
          <View onLayout={onLayout} style={s.section}>
            <View style={[s.divider, { backgroundColor: colors.surfaceBorder }]} />
            {renderSectionHeader(
              'location-outline',
              t('notes.section.location', { defaultValue: '地址' }),
            )}
            <View style={s.locationRow}>
              <Ionicons name="location-outline" size={20} color={colors.iconAccent} />
              <View style={s.locationBody}>
                <Text style={[s.locationTitle, { color: colors.text }]}>
                  {sections.location?.title ||
                    t('notes.detail.locationFallback', { defaultValue: '位置' })}
                </Text>
                {sections.location?.address ? (
                  <Text style={[s.meta, { color: colors.textSecondary }]}>
                    {sections.location.address}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null;
      default:
        return null;
    }
  };

  const documentHeader = (
    <>
      <Text style={[s.title, { color: colors.text }]}>{title}</Text>
      <View style={s.metaRow}>
        <Text style={[s.meta, { color: colors.text }]}>
          {formatNoteFullDate(createdAt, t)}
        </Text>
        {groups.length > 0 ? <Text style={[s.meta, { color: colors.text }]}>·</Text> : null}
        {groups.map((group) => (
          <View key={group.id} style={[s.groupTag, { backgroundColor: colors.brandPurple }]}>
            <Text style={[s.groupTagText, { color: colors.white }]}>{group.name}</Text>
          </View>
        ))}
      </View>
    </>
  );

  const getSectionMeta = (kind: NoteSectionKind) => {
    switch (kind) {
      case 'text':
        return { icon: 'text-outline' as const, label: t('notes.section.text', { defaultValue: '文字' }) };
      case 'media':
        return { icon: 'image-outline' as const, label: t('notes.section.media', { defaultValue: '图片 · 视频' }) };
      case 'showcase':
        return { icon: 'albums-outline' as const, label: t('notes.section.showcase', { defaultValue: '展示' }) };
      case 'audio':
        return { icon: 'mic-outline' as const, label: t('notes.section.audio', { defaultValue: '录音' }) };
      case 'contact':
        return { icon: 'person-outline' as const, label: t('notes.section.contact', { defaultValue: '名片' }) };
      case 'group':
        return { icon: 'people-outline' as const, label: t('notes.section.group', { defaultValue: '群名片' }) };
      case 'location':
        return { icon: 'location-outline' as const, label: t('notes.section.location', { defaultValue: '地址' }) };
      default:
        return { icon: 'document-outline' as const, label: '' };
    }
  };

  const renderVirtualizedRow = ({ item }: { item: VirtualizedNoteRow }) => {
    switch (item.type) {
      case 'section': {
        const meta = getSectionMeta(item.kind);
        return (
          <View
            onLayout={item.trackLayout ? onSectionLayout?.(item.kind) : undefined}
            style={[s.virtualSectionStart, item.divider && s.virtualSectionDivider]}
          >
            {item.divider ? <View style={[s.divider, { backgroundColor: colors.surfaceBorder }]} /> : null}
            {renderSectionHeader(meta.icon, meta.label)}
          </View>
        );
      }
      case 'block':
        return (
          <View style={s.virtualBlock}>
            <NoteBlockRenderer
              blocks={[item.block]}
              onContactPress={onContactPress} onGroupPress={onGroupPress}
              onMediaError={onMediaError}
              onImagePress={onImagePress}
              lazyMedia={lazyMedia}
            />
          </View>
        );
      case 'text':
        return (
          <View style={s.virtualBlock}>
            {item.empty ? (
              <Text style={[s.emptyHint, { color: colors.textSecondary }]}>
                {t('notes.section.emptyText', { defaultValue: '暂无文字内容' })}
              </Text>
            ) : (
              <Text style={[s.bodyText, { color: colors.text }]}>{item.content}</Text>
            )}
          </View>
        );
      case 'location':
        return (
          <View style={s.virtualBlock}>
            <View style={s.locationRow}>
              <Ionicons name="location-outline" size={20} color={colors.iconAccent} />
              <View style={s.locationBody}>
                <Text style={[s.locationTitle, { color: colors.text }]}>
                  {item.title ||
                    t('notes.detail.locationFallback', { defaultValue: '位置' })}
                </Text>
                {item.address ? (
                  <Text style={[s.meta, { color: colors.textSecondary }]}>
                    {item.address}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        );
      case 'spacer':
        return <View style={s.virtualSectionEnd} />;
      default:
        return null;
    }
  };

  return (
    virtualized ? (
      <FlatList
        data={virtualizedRows}
        keyExtractor={(item) => item.id}
        renderItem={renderVirtualizedRow}
        ListHeaderComponent={documentHeader}
        style={s.virtualizedList}
        contentContainerStyle={[
          s.virtualizedContent,
          { paddingBottom: contentPaddingBottom },
        ]}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={16}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
      />
    ) : (
      <>
        {documentHeader}
        {documentInstances.map((entry) => (
          <View key={entry.id}>{renderSection(entry)}</View>
        ))}
      </>
    )
  );
});

const s = StyleSheet.create({
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
  emptyHint: { ...Typography.caption, fontWeight: '400' },
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
  virtualizedList: { flex: 1 },
  virtualizedContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  virtualSectionStart: { gap: Spacing.md - 4 },
  virtualSectionDivider: { paddingTop: Spacing.md - 4 },
  virtualBlock: { paddingTop: Spacing.sm },
  virtualSectionEnd: { height: Spacing.lg },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  locationBody: { flex: 1 },
  locationTitle: { ...Typography.body, fontWeight: '600' },
});
