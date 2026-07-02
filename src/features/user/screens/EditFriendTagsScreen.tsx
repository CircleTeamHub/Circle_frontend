import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import {
  assignFriendTag,
  createFriendTag,
  fetchFriendSettings,
  type FriendTag,
  removeFriendTag,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

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
  const { t } = useTranslation();
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
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    if (!profileId) {
      setError(t('userProfile.editTags.missingFriend'));
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
          setError(t('userProfile.editTags.loadFailed'));
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
  }, [profileId, t]);

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
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      tagText: {
        color: colors.text,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      tagTextActive: {
        color: colors.white,
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
      if (!mountedRef.current) return;

      setAvailableTags((current) => {
        const deduped = current.filter((tag) => tag.id !== created.id);
        return sortTags([...deduped, created]);
      });
      setSelectedTagIds((current) =>
        current.includes(created.id) ? current : [...current, created.id],
      );
      setNewTagName('');
    } catch (nextError) {
      if (!mountedRef.current) return;
      Alert.alert(
        t('userProfile.editTags.createFailedTitle'),
        getApiErrorMessage(nextError, t('userProfile.editTags.createFailed')),
      );
    } finally {
      if (mountedRef.current) setIsCreatingTag(false);
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
      if (!mountedRef.current) return;
      router.back();
    } catch (nextError) {
      if (!mountedRef.current) return;
      Alert.alert(
        t('validation.saveFailed'),
        getApiErrorMessage(nextError, t('userProfile.editTags.saveFailed')),
      );
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  };

  const stateBlock = isLoading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('contacts.tagsScreen.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
    </View>
  ) : (
    <View style={[s.card, d.card]}>
      <Text style={[s.fieldLabel, d.fieldLabel]}>{t('userProfile.editTags.label')}</Text>
      <Text style={[s.helper, d.helper]}>
        {t('userProfile.editTags.helper')}
      </Text>
      <View style={s.createRow}>
        <TextInput
          value={newTagName}
          onChangeText={setNewTagName}
          maxLength={30}
          placeholder={t('userProfile.editTags.newTagPlaceholder')}
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
          <Text style={d.addButtonText}>
            {isCreatingTag ? t('userProfile.editTags.creating') : t('userProfile.editTags.create')}
          </Text>
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
        <Text style={d.stateText}>{t('userProfile.editTags.empty')}</Text>
      )}
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.tags')} />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
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
          <Text style={d.saveButtonText}>{isSaving ? t('common.saving') : t('common.save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
