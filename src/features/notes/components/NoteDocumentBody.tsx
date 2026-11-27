import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { NoteBlockRenderer } from '@/features/notes/components/NoteBlockRenderer';
import { NoteMaterialBadge } from '@/features/notes/components/NoteMaterialBadge';
import {
  getNoteSectionAvailability,
  type NoteSectionKind,
  type NoteSections,
} from '@/features/notes/utils/note-sections';
import { getNoteDocumentInstances, noteMediaBlocks } from '@/features/notes/utils/note-document-layout';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export type NoteDocumentGroup = {
  id: string;
  name: string;
};

type NoteDocumentBodyProps = {
  title: string;
  city?: string | null;
  createdAt: string;
  groups: readonly NoteDocumentGroup[];
  sections: NoteSections;
  order: readonly NoteSectionKind[];
  layout?: unknown;
  onContactPress?: (id: string, name?: string) => void;
  onGroupPress?: (id: string, name?: string, conversationID?: string) => void;
  onMediaError?: () => void;
  onImagePress?: (uri: string, objectKey?: string) => void;
  lazyMedia?: boolean;
  virtualized?: boolean;
  contentPaddingBottom?: number;
  onSectionLayout?: (kind: NoteSectionKind) => (event: LayoutChangeEvent) => void;
};

type DocumentRow = { id: string; sectionStart?: NoteSectionKind } & (
  | { type: 'block'; block: Record<string, unknown>; showcase: boolean }
  | { type: 'text'; content: string | null }
  | { type: 'location'; title?: string | null; address?: string | null }
);

export const NoteDocumentBody = memo(function NoteDocumentBody({
  title,
  city,
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

  const rows = useMemo<DocumentRow[]>(() => {
    const result: DocumentRow[] = [];
    const anchored = new Set<NoteSectionKind>();
    for (const { id, kind, sections: own } of getNoteDocumentInstances(sections, order, layout)) {
      const start = result.length;
      const appendBlocks = (blocks: Record<string, unknown>[]) => {
        blocks.forEach((block, index) => {
          if (!block || typeof block !== 'object') return;
          result.push({ type: 'block', id: `${id}-${index}`, block, showcase: kind === 'showcase' && block.type === 'video' });
        });
      };
      switch (kind) {
        case 'text':
          if (getNoteSectionAvailability(own).hasText) {
            if (own.text.contentJson?.length) appendBlocks(own.text.contentJson);
            else result.push({ type: 'text', id, content: own.text.content });
          }
          break;
        case 'media':
        case 'showcase':
        case 'audio':
          appendBlocks(noteMediaBlocks(own[kind].items));
          break;
        case 'contact':
          appendBlocks(own.contacts.items.map((card) => ({ type: 'contact', props: card })));
          break;
        case 'group':
          appendBlocks(own.groups.items.map((card) => ({ type: 'group', props: card })));
          break;
        case 'location':
          if (getNoteSectionAvailability(own).hasLocation) {
            result.push({ type: 'location', id, title: own.location?.title, address: own.location?.address });
          }
          break;
      }
      // 聊天笔记卡的分块跳转仍定位到该类型的第一个内容项。
      if (result.length > start && !anchored.has(kind)) {
        result[start].sectionStart = kind;
        anchored.add(kind);
      }
    }
    return result.length ? result : [{ type: 'text', id: 'empty', content: null }];
  }, [sections, order, layout]);

  const renderRow = (item: DocumentRow) => {
    const onLayout = item.sectionStart ? onSectionLayout?.(item.sectionStart) : undefined;
    if (item.type === 'text') {
      return (
        <View key={item.id} onLayout={onLayout} style={[s.row, s.textInset]}>
          <Text style={item.content ? [s.bodyText, { color: colors.text }] : [s.emptyHint, { color: colors.textSecondary }]}>
            {item.content ?? t('notes.section.emptyText', { defaultValue: '暂无文字内容' })}
          </Text>
        </View>
      );
    }
    if (item.type === 'location') {
      return (
        <View key={item.id} testID="note-document-material" onLayout={onLayout} style={s.row}>
          <NoteMaterialBadge label={t('notes.edit.sections.location', { defaultValue: '位置' })} overlay={false} />
          <View style={s.locationRow}>
            <Ionicons name="location-outline" size={20} color={colors.iconAccent} />
            <View style={s.locationBody}>
              <Text style={[s.locationTitle, { color: colors.text }]}>
                {item.title || t('notes.detail.locationFallback', { defaultValue: '位置' })}
              </Text>
              {item.address ? <Text style={[s.meta, { color: colors.textSecondary }]}>{item.address}</Text> : null}
            </View>
          </View>
        </View>
      );
    }

    const type = item.block.type;
    const visual = type === 'image' || type === 'video';
    let label: string | undefined;
    switch (type) {
      case 'image': label = t('notes.section.image', { defaultValue: '图片' }); break;
      case 'video': label = item.showcase
        ? t('notes.edit.sections.showcase', { defaultValue: '展示视频' })
        : t('notes.section.video', { defaultValue: '视频' }); break;
      case 'audio': label = t('notes.section.audio', { defaultValue: '录音' }); break;
      case 'contact': label = t('notes.section.contact', { defaultValue: '名片' }); break;
      case 'group': label = t('notes.section.group', { defaultValue: '群名片' }); break;
    }
    return (
      <View
        key={item.id}
        testID={label ? 'note-document-material' : undefined}
        onLayout={onLayout}
        style={[s.row, !label && s.textInset]}
      >
        {label && !visual ? <NoteMaterialBadge label={label} overlay={false} /> : null}
        <NoteBlockRenderer
          blocks={[item.block]}
          onContactPress={onContactPress}
          onGroupPress={onGroupPress}
          onMediaError={onMediaError}
          onImagePress={onImagePress}
          lazyMedia={lazyMedia}
        />
        {label && visual ? <NoteMaterialBadge label={label} showcase={item.showcase} /> : null}
      </View>
    );
  };

  const documentHeader = (
    <View style={[s.documentHeader, s.textInset]}>
      <Text style={[s.title, { color: colors.text }]}>{title}</Text>
      <View style={s.metaRow}>
        <Text style={[s.meta, { color: colors.text }]}>{formatNoteFullDate(createdAt, t)}</Text>
        {city ? <Text style={[s.meta, { color: colors.text }]}>· {city}</Text> : null}
        {groups.length > 0 ? <Text style={[s.meta, { color: colors.text }]}>·</Text> : null}
        {groups.map((group) => (
          <View key={group.id} style={[s.groupTag, { backgroundColor: colors.brandPurple }]}>
            <Text style={[s.groupTagText, { color: colors.white }]}>{group.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return virtualized ? (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => renderRow(item)}
      ListHeaderComponent={documentHeader}
      style={s.list}
      contentContainerStyle={[s.virtualizedContent, { paddingBottom: contentPaddingBottom }]}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={16}
      windowSize={7}
      removeClippedSubviews
      showsVerticalScrollIndicator={false}
    />
  ) : (
    <>{documentHeader}{rows.map(renderRow)}</>
  );
});

const s = StyleSheet.create({
  list: { flex: 1 },
  virtualizedContent: { paddingHorizontal: Spacing.sm, paddingTop: Spacing.md },
  textInset: { paddingHorizontal: Spacing.sm },
  documentHeader: { marginBottom: Spacing.md },
  title: { ...Typography.h1, lineHeight: 32, marginBottom: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm },
  meta: { ...Typography.caption, fontWeight: '400' },
  groupTag: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.xs },
  groupTagText: { ...Typography.small, fontWeight: '600' },
  row: { marginBottom: Spacing.sm },
  bodyText: { ...Typography.bodyRegular, fontSize: 15, lineHeight: 26 },
  emptyHint: { ...Typography.caption, fontWeight: '400' },
  locationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  locationBody: { flex: 1 },
  locationTitle: { ...Typography.body, fontWeight: '600' },
});
