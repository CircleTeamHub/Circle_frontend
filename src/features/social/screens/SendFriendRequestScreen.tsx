import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { buildSendFriendRequestInitialMessage } from '@/features/social/send-friend-request';
import {
  createFriendRequest,
  fetchFriendTags,
  type FriendTag,
} from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const PLACEHOLDER_ROW_KEYS = ['remark', 'photoRemark', 'friendPermissions'] as const;

const s = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cardTitle: {
    ...Typography.body,
    fontWeight: '600',
  },
  fieldBlock: {
    gap: Spacing.sm,
  },
  fieldLabel: {
    ...Typography.small,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    ...Typography.bodyRegular,
  },
  messageInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  placeholderRow: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  placeholderMeta: {
    flex: 1,
    gap: 4,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tagChip: {
    minHeight: 36,
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
  submitButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function SendFriendRequestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const profileId = typeof params.id === 'string' ? params.id : '';
  const targetName =
    typeof params.name === 'string' ? params.name : t('contacts.request.targetFallback');

  const initialMessage = useMemo(
    () =>
      buildSendFriendRequestInitialMessage({
        nickname: currentUser?.nickname,
        accountId: currentUser?.accountId || t('contacts.request.selfFallback'),
      }),
    [currentUser?.accountId, currentUser?.nickname, t],
  );
  const [message, setMessage] = useState(initialMessage);
  const [remark, setRemark] = useState('');
  const [tags, setTags] = useState<FriendTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  const [tagLoadError, setTagLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setIsLoadingTags(true);
    setTagLoadError(null);

    fetchFriendTags()
      .then((nextTags) => {
        if (cancelled) {
          return;
        }

        setTags(nextTags);
        setTagLoadError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setTags([]);
          setTagLoadError(t('contacts.request.tagLoadError'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTags(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      card: {
        backgroundColor: colors.surface,
      },
      cardTitle: {
        color: colors.text,
      },
      helperText: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      fieldLabel: {
        color: colors.textSecondary,
      },
      input: {
        color: colors.text,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      placeholderRow: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
        opacity: 0.7,
      },
      placeholderTitle: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      placeholderHint: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      tagChip: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      tagChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primary,
      },
      tagChipText: {
        color: colors.text,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      tagChipTextActive: {
        color: colors.white,
      },
      submitButton: {
        backgroundColor: colors.primary,
      },
      submitButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      submitText: {
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

  const handleSubmit = async () => {
    if (!profileId || isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      await createFriendRequest({
        targetId: profileId,
        message,
        remark,
        tagIds: selectedTagIds,
      });
      Alert.alert(t('contacts.request.sentTitle'), t('contacts.request.sentMessage', { name: targetName }), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert(
        t('contacts.request.sendFailedTitle'),
        error instanceof Error ? error.message : t('contacts.request.sendFailed'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('contacts.request.title')} />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={[s.card, d.card]}>
          <Text style={[s.cardTitle, d.cardTitle]}>{targetName}</Text>
          <Text style={d.helperText}>{t('contacts.request.intro')}</Text>
        </View>

        <View style={[s.card, d.card]}>
          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>{t('contacts.request.messageLabel')}</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder={t('contacts.request.messagePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={[s.input, s.messageInput, d.input]}
            />
          </View>

          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>{t('contacts.request.remarkLabel')}</Text>
            <TextInput
              value={remark}
              onChangeText={setRemark}
              placeholder={t('contacts.request.remarkPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={[s.input, d.input]}
            />
          </View>

          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>{t('contacts.request.tagsLabel')}</Text>
            {isLoadingTags ? (
              <View style={[s.placeholderRow, d.placeholderRow]}>
                <View style={s.placeholderMeta}>
                  <Text style={d.placeholderTitle}>{t('contacts.request.tagsLoadingTitle')}</Text>
                  <Text style={d.placeholderHint}>{t('contacts.request.tagsLoadingHint')}</Text>
                </View>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : tags.length > 0 ? (
              <View style={s.tagsWrap}>
                {tags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);

                  return (
                    <Pressable
                      key={tag.id}
                      style={[
                        s.tagChip,
                        d.tagChip,
                        selected ? d.tagChipActive : null,
                      ]}
                      onPress={() => toggleTag(tag.id)}
                    >
                      <Text
                        style={[
                          d.tagChipText,
                          selected ? d.tagChipTextActive : null,
                        ]}
                      >
                        {tag.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[s.placeholderRow, d.placeholderRow]}>
                <View style={s.placeholderMeta}>
                  <Text style={d.placeholderTitle}>{t('contacts.request.noTagsTitle')}</Text>
                  <Text style={d.placeholderHint}>
                    {tagLoadError ?? t('contacts.request.noTagsHint')}
                  </Text>
                </View>
                <Ionicons
                  name="pricetag-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </View>
            )}
          </View>
        </View>

        <View style={[s.card, d.card]}>
          {/* placeholder only rows for Task 4 UI */}
          {PLACEHOLDER_ROW_KEYS.map((rowKey) => (
            <Pressable
              key={rowKey}
              disabled
              style={[s.placeholderRow, d.placeholderRow]}
            >
              <View style={s.placeholderMeta}>
                <Text style={d.placeholderTitle}>{t(`contacts.request.placeholderRows.${rowKey}`)}</Text>
                <Text style={d.placeholderHint}>{t('contacts.request.placeholderDisabled')}</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[
            s.submitButton,
            d.submitButton,
            !profileId || isSubmitting ? d.submitButtonDisabled : null,
          ]}
          disabled={!profileId || isSubmitting}
          onPress={handleSubmit}
        >
          <Text style={d.submitText}>{isSubmitting ? t('common.sending') : t('common.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
