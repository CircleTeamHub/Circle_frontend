import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoteBlockEditor } from '@/features/notes/components/NoteBlockEditor';
import type { CreateNoteMediaInput } from '@/features/notes/types';
import { extractMediaFromBlocks, extractPlainText } from '@/features/notes/utils/note-blocks';
import { formatNoteFullDate } from '@/features/notes/utils/note-format';
import { createNote, fetchNoteDetail, updateNote } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export default function EditNoteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [title, setTitle] = useState('');
  // Store blocks in a ref — no setState means no re-render, which prevents
  // Expo DOM bridge from calling injectJavaScript on a torn-down WebView.
  const blocksRef = useRef<Record<string, unknown>[]>([]);
  const [initialBlocks, setInitialBlocks] = useState<Record<string, unknown>[] | null>(null);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [groupName, setGroupName] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [dateStr, setDateStr] = useState(formatNoteFullDate(new Date().toISOString()));
  // url → upload metadata — ref so it doesn't cause re-renders either.
  const mediaMapRef = useRef<Record<string, CreateNoteMediaInput>>({});

  // Controls whether the WebView is mounted. We set this to false BEFORE
  // calling router.back() so React has one render cycle to unmount the WebView
  // natively before navigation begins — preventing the "Unable to find
  // 'DomWebView' view" bridge crash.
  const [editorMounted, setEditorMounted] = useState(false);

  useEffect(() => {
    if (!isEdit || !id) return;
    let cancelled = false;
    fetchNoteDetail(id)
      .then((note) => {
        if (cancelled) return;
        setTitle(note.title);
        const loaded = note.contentJson ?? [];
        blocksRef.current = loaded;
        setInitialBlocks(loaded.length > 0 ? loaded : null);
        setGroupId(note.group?.id);
        setGroupName(note.group?.name);
        setDateStr(formatNoteFullDate(note.createdAt));
        setLoading(false);
        setEditorMounted(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setEditorMounted(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  // For new notes (no id), mount editor immediately.
  useEffect(() => {
    if (!isEdit) setEditorMounted(true);
  }, [isEdit]);

  const handleContentChange = useCallback((newBlocks: Record<string, unknown>[]) => {
    blocksRef.current = newBlocks;
  }, []);

  const handleMediaUploaded = useCallback((media: CreateNoteMediaInput) => {
    mediaMapRef.current = { ...mediaMapRef.current, [media.url]: media };
  }, []);

  // Unmount the WebView first, then navigate on the next frame.
  const navigateBack = useCallback(() => {
    setEditorMounted(false);
    requestAnimationFrame(() => router.back());
  }, [router]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setIsSubmitting(true);
    try {
      const currentBlocks = blocksRef.current;
      const plainText = extractPlainText(currentBlocks);
      const media = extractMediaFromBlocks(currentBlocks).map((m) => {
        const uploaded = mediaMapRef.current[m.url];
        return uploaded ? { ...uploaded, sortOrder: m.sortOrder } : m;
      });
      const input = {
        title: trimmedTitle,
        content: plainText,
        contentJson: currentBlocks,
        groupId,
        media,
        status: 'ACTIVE' as const,
      };
      if (isEdit && id) {
        await updateNote(id, input);
      } else {
        await createNote(input);
      }
      navigateBack();
    } catch {
      setIsSubmitting(false);
    }
  }, [isSubmitting, title, groupId, isEdit, id, navigateBack]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      headerTitle: { color: colors.text },
      doneBtn: { backgroundColor: colors.primary },
      doneBtnText: { color: colors.white },
      doneBtnDisabled: { backgroundColor: colors.primary, opacity: 0.5 },
      titleInput: { color: colors.text },
      dateText: { color: colors.textSecondary },
      groupTag: { backgroundColor: colors.primary + '33' },
      groupTagText: { color: colors.primary },
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
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={navigateBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, d.headerTitle]}>
          {isEdit ? '编辑笔记' : '新建笔记'}
        </Text>
        <Pressable
          style={[s.doneBtn, d.doneBtn, isDoneDisabled && d.doneBtnDisabled]}
          onPress={handleSubmit}
          disabled={isDoneDisabled}
        >
          <Text style={[s.doneBtnText, d.doneBtnText]}>
            {isSubmitting ? '保存中...' : '完成'}
          </Text>
        </Pressable>
      </View>

      {/* Title */}
      <TextInput
        style={[s.titleInput, d.titleInput]}
        placeholder="标题"
        placeholderTextColor={colors.textSecondary}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        returnKeyType="next"
      />

      {/* Date + optional group */}
      <View style={s.metaRow}>
        <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
        <Text style={[s.dateText, d.dateText]}>{dateStr}</Text>
        {groupName ? (
          <View style={[s.groupTag, d.groupTag]}>
            <Text style={[s.groupTagText, d.groupTagText]}>{groupName}</Text>
          </View>
        ) : null}
      </View>

      {/* Editor — conditionally mounted so we can tear it down before navigating */}
      <View style={s.editorWrap}>
        {editorMounted && (
          <NoteBlockEditor
            initialContent={initialBlocks}
            onContentChange={handleContentChange}
            onMediaUploaded={handleMediaUploaded}
          />
        )}
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
    paddingVertical: Spacing.sm,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 36,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  dateText: { ...Typography.caption },
  groupTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    marginLeft: Spacing.xs,
  },
  groupTagText: { ...Typography.small, fontWeight: '600' },
  editorWrap: { flex: 1 },
});
