import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Image } from 'expo-image';
import { NavHeader } from '@/components/ui/nav-header';
import { buildSendFriendRequestInitialMessage } from '@/features/social/send-friend-request';
import {
  createSingleFlightRunner,
  getFriendRequestSubmitState,
} from '@/features/social/send-friend-request-submit';
import {
  useFriendPhotoNotes,
  FRIEND_PHOTO_NOTE_LIMIT,
} from '@/features/social/hooks/use-friend-photo-notes';
import {
  createFriendRequest,
  fetchFriendTags,
  type FriendPermission,
  type FriendTag,
} from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const PERMISSION_OPTIONS: readonly FriendPermission[] = ['FULL', 'CHAT_ONLY'];

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
  photosWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  photoTile: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoTile: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionOption: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  permissionMeta: {
    flex: 1,
    gap: 2,
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
  const params = useLocalSearchParams<{ id?: string; name?: string; qrToken?: string }>();
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
  const [description, setDescription] = useState('');
  const [permission, setPermission] = useState<FriendPermission>('FULL');
  const [tags, setTags] = useState<FriendTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  const [tagLoadError, setTagLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitRunnerRef = useRef(createSingleFlightRunner());
  const {
    photos,
    addPhoto,
    removePhoto,
    uploading: isUploadingPhoto,
    canAddMore: canAddMorePhotos,
  } = useFriendPhotoNotes();
  const submitState = getFriendRequestSubmitState({
    hasProfile: Boolean(profileId),
    isSubmitting,
    isUploadingPhoto,
  });

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
      photoTile: {
        backgroundColor: colors.background,
      },
      photoRemove: {
        backgroundColor: 'rgba(0,0,0,0.55)',
      },
      addPhotoTile: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      permissionOption: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      permissionOptionActive: {
        borderColor: colors.primary,
      },
      permissionTitle: {
        color: colors.text,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      permissionHint: {
        color: colors.textSecondary,
        ...Typography.tiny,
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
    if (submitState.disabled) {
      return;
    }

    await submitRunnerRef.current.run(async () => {
      try {
        setIsSubmitting(true);
        await createFriendRequest({
          targetId: profileId,
          message,
          remark,
          tagIds: selectedTagIds,
          description,
          photos,
          permission,
          // 扫名片码进来的申请:带上服务端签发的令牌,对方 addMeByQrCode 开着即放行。
          qrToken: typeof params.qrToken === 'string' ? params.qrToken : undefined,
        });
        Alert.alert(t('contacts.request.sentTitle'), t('contacts.request.sentMessage', { name: targetName }), [
          { text: t('common.ok'), onPress: () => router.back() },
        ]);
      } catch (error) {
        Alert.alert(
          t('contacts.request.sendFailedTitle'),
          getApiErrorMessage(error, t('contacts.request.sendFailed')),
        );
      } finally {
        setIsSubmitting(false);
      }
    });
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
          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>
              {t('contacts.request.descriptionLabel')}
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
              placeholder={t('contacts.request.descriptionPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              style={[s.input, s.messageInput, d.input]}
            />
          </View>

          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>
              {t('contacts.request.photosLabel')}
            </Text>
            <View style={s.photosWrap}>
              {photos.map((uri) => (
                <View key={uri} style={[s.photoTile, d.photoTile]}>
                  <Image
                    source={{ uri }}
                    style={s.photoImage}
                    contentFit="cover"
                  />
                  <Pressable
                    style={[s.photoRemove, d.photoRemove]}
                    onPress={() => removePhoto(uri)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('contacts.request.photos.remove')}
                  >
                    <Ionicons name="close" size={14} color={colors.white} />
                  </Pressable>
                </View>
              ))}
              {canAddMorePhotos ? (
                <Pressable
                  style={[s.addPhotoTile, d.addPhotoTile]}
                  onPress={addPhoto}
                  disabled={isUploadingPhoto}
                  accessibilityRole="button"
                  accessibilityLabel={t('contacts.request.photos.add')}
                >
                  {isUploadingPhoto ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Ionicons
                      name="add"
                      size={26}
                      color={colors.textSecondary}
                    />
                  )}
                </Pressable>
              ) : null}
            </View>
            <Text style={d.placeholderHint}>
              {t('contacts.request.photos.hint', {
                count: FRIEND_PHOTO_NOTE_LIMIT,
              })}
            </Text>
          </View>

          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>
              {t('contacts.request.permissionLabel')}
            </Text>
            {PERMISSION_OPTIONS.map((option) => {
              const selected = permission === option;

              return (
                <Pressable
                  key={option}
                  style={[
                    s.permissionOption,
                    d.permissionOption,
                    selected ? d.permissionOptionActive : null,
                  ]}
                  onPress={() => setPermission(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View style={s.permissionMeta}>
                    <Text style={d.permissionTitle}>
                      {t(`contacts.request.permissionOptions.${option}.title`)}
                    </Text>
                    <Text style={d.permissionHint}>
                      {t(`contacts.request.permissionOptions.${option}.hint`)}
                    </Text>
                  </View>
                  <Ionicons
                    name={
                      selected ? 'radio-button-on' : 'radio-button-off'
                    }
                    size={20}
                    color={selected ? colors.primary : colors.textSecondary}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[
            s.submitButton,
            d.submitButton,
            submitState.disabled ? d.submitButtonDisabled : null,
          ]}
          disabled={submitState.disabled}
          onPress={handleSubmit}
        >
          <Text style={d.submitText}>
            {submitState.activity === 'idle'
              ? t('common.send')
              : t('common.sending')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
