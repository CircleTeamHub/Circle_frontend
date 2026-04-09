import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import {
  assignFriendTag,
  createFriendTag,
  fetchFriendSettings,
  type FriendTag,
  removeFriendTag,
} from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  helper: {
    ...Typography.small,
  },
  fieldLabel: {
    ...Typography.small,
    fontWeight: '600',
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  createRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    ...Typography.bodyRegular,
  },
  addButton: {
    minWidth: 72,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tagChip: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  saveButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function sortTags(tags: FriendTag[]) {
  return [...tags].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' }),
  );
}

export default function EditFriendTagsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : '';

  const [availableTags, setAvailableTags] = useState<FriendTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [initialSelectedTagIds, setInitialSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!profileId) {
      setError('好友不存在');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchFriendSettings(profileId)
      .then((settings) => {
        if (cancelled) {
          return;
        }

        const nextAvailableTags = sortTags(settings.availableTags);
        const nextSelectedTagIds = settings.assignedTags.map((tag) => tag.id);

        setAvailableTags(nextAvailableTags);
        setSelectedTagIds(nextSelectedTagIds);
        setInitialSelectedTagIds(nextSelectedTagIds);
      })
      .catch(() => {
        if (!cancelled) {
          setError('标签加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      card: {
        backgroundColor: colors.surface,
      },
      helper: {
        color: colors.textSecondary,
      },
      fieldLabel: {
        color: colors.textSecondary,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      input: {
        color: colors.text,
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      addButton: {
        backgroundColor: colors.primary,
      },
      addButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      addButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      tagChip: {
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      tagChipActive: {
        backgroundColor: colors.primaryLight,
        borderColor: colors.primary,
      },
      tagText: {
        color: colors.text,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      tagTextActive: {
        color: colors.primary,
      },
      saveButton: {
        backgroundColor: colors.primary,
      },
      saveButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      saveButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((item) => item !== tagId)
        : [...current, tagId],
    );
  };

  const handleCreateTag = async () => {
    const trimmed = newTagName.trim();

    if (!trimmed || isCreatingTag) {
      return;
    }

    try {
      setIsCreatingTag(true);
      const created = await createFriendTag(trimmed);

      setAvailableTags((current) => {
        const deduped = current.filter((tag) => tag.id !== created.id);
        return sortTags([...deduped, created]);
      });
      setSelectedTagIds((current) =>
        current.includes(created.id) ? current : [...current, created.id],
      );
      setNewTagName('');
    } catch (nextError) {
      Alert.alert(
        '创建失败',
        nextError instanceof Error ? nextError.message : '标签创建失败，请稍后重试',
      );
    } finally {
      setIsCreatingTag(false);
    }
  };

  const handleSave = async () => {
    if (!profileId || isSaving) {
      return;
    }

    const initialSet = new Set(initialSelectedTagIds);
    const nextSet = new Set(selectedTagIds);
    const removedIds = initialSelectedTagIds.filter((tagId) => !nextSet.has(tagId));
    const addedIds = selectedTagIds.filter((tagId) => !initialSet.has(tagId));

    try {
      setIsSaving(true);
      await Promise.all([
        ...addedIds.map((tagId) => assignFriendTag(profileId, tagId)),
        ...removedIds.map((tagId) => removeFriendTag(profileId, tagId)),
      ]);
      router.back();
    } catch (nextError) {
      Alert.alert(
        '保存失败',
        nextError instanceof Error ? nextError.message : '标签保存失败，请稍后重试',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const stateBlock = isLoading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>正在加载标签...</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
    </View>
  ) : (
    <View style={[s.card, d.card]}>
      <Text style={[s.fieldLabel, d.fieldLabel]}>选择好友标签</Text>
      <Text style={[s.helper, d.helper]}>
        已选中的标签会应用到这位好友上，也可以在这里直接新建标签。
      </Text>
      <View style={s.createRow}>
        <TextInput
          value={newTagName}
          onChangeText={setNewTagName}
          maxLength={30}
          placeholder="新建标签"
          placeholderTextColor={colors.textSecondary}
          style={[s.input, d.input]}
        />
        <Pressable
          style={[
            s.addButton,
            d.addButton,
            !newTagName.trim() || isCreatingTag ? d.addButtonDisabled : null,
          ]}
          disabled={!newTagName.trim() || isCreatingTag}
          onPress={handleCreateTag}
        >
          <Text style={d.addButtonText}>{isCreatingTag ? '创建中' : '新建'}</Text>
        </Pressable>
      </View>
      {availableTags.length > 0 ? (
        <View style={s.tagsWrap}>
          {availableTags.map((tag) => {
            const isActive = selectedTagIds.includes(tag.id);

            return (
              <Pressable
                key={tag.id}
                style={[s.tagChip, d.tagChip, isActive ? d.tagChipActive : null]}
                onPress={() => toggleTag(tag.id)}
              >
                <Text
                  style={[d.tagText, isActive ? d.tagTextActive : null]}
                >
                  {tag.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={d.stateText}>还没有标签，先创建一个再保存。</Text>
      )}
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="标签" />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {stateBlock}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[
            s.saveButton,
            d.saveButton,
            isLoading || Boolean(error) || isSaving ? d.saveButtonDisabled : null,
          ]}
          disabled={isLoading || Boolean(error) || isSaving}
          onPress={handleSave}
        >
          <Text style={d.saveButtonText}>{isSaving ? '保存中...' : '保存'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
