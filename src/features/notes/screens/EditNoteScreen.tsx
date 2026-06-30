import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LogBox,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteBlockEditor } from '@/features/notes/components/NoteBlockEditor';
import type { CreateNoteMediaInput, NoteGroup } from '@/features/notes/types';
import {
  buildNoteMediaMap,
  extractMediaFromBlocks,
  extractPlainText,
  mergeExtractedMediaWithMediaMap,
} from '@/features/notes/utils/note-blocks';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import {
  createNote,
  fetchNoteDetail,
  fetchNoteGroups,
  updateNote,
} from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

LogBox.ignoreLogs([
  "Calling the 'injectJavaScript' function has failed",
  'Unable to find the',
  'DomWebView',
]);

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
  const mediaMapRef = useRef<Record<string, CreateNoteMediaInput>>({});
  const [editorMounted, setEditorMounted] = useState(false);
  const [navigating, setNavigating] = useState(false);

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
      mediaMapRef.current = {};
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
        const loaded = note.contentJson ?? [];
        blocksRef.current = loaded;
        setInitialBlocks(loaded.length > 0 ? loaded : null);
        mediaMapRef.current = buildNoteMediaMap(note.media);
        setSelectedGroupIds(note.groups.map((group) => group.id));
        setDateStr(formatNoteFullDate(note.createdAt, t));
        setLoading(false);
        setEditorMounted(true);
      })
      .catch(() => {
        if (!cancelled) {
          mediaMapRef.current = {};
          setLoading(false);
          setEditorMounted(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, isEdit, t]);

  const handleContentChange = useCallback((newBlocks: Record<string, unknown>[]) => {
    blocksRef.current = newBlocks;
  }, []);

  const handleMediaUploaded = useCallback((media: CreateNoteMediaInput) => {
    mediaMapRef.current = { ...mediaMapRef.current, [media.url]: media };
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
      const currentBlocks = blocksRef.current;
      const plainText = extractPlainText(currentBlocks);
      const media = mergeExtractedMediaWithMediaMap(
        extractMediaFromBlocks(currentBlocks),
        mediaMapRef.current,
      );
      const showcase = media.filter((item) => item.type === 'IMAGE');
      const input = {
        title: trimmedTitle,
        content: plainText,
        contentJson: currentBlocks,
        sections: {
          text: { content: plainText, contentJson: currentBlocks },
          media: { items: media },
          showcase: { items: showcase },
          location: null,
        },
        groupIds: selectedGroupIds,
        media,
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
  }, [id, isEdit, isSubmitting, navigateBack, selectedGroupIds, t, title]);

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

      <View style={s.editorWrap}>
        {editorMounted ? (
          <NoteBlockEditor
            initialContent={initialBlocks}
            onContentChange={handleContentChange}
            onMediaUploaded={handleMediaUploaded}
          />
        ) : null}
      </View>
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
  titleInput: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
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
  groupChipActive: {
    borderWidth: 1,
  },
  groupChipText: { ...Typography.small, fontWeight: '600' },
  editorWrap: { flex: 1 },
});
