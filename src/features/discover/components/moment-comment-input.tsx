import { UploadProgressHost } from '@/components/app/UploadProgressHost';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import {
  MODAL_INPUT_NATIVE_AUTO_FOCUS,
  useModalInputAutoFocus,
} from '@/hooks/use-modal-input-auto-focus';
import { EmojiPicker } from '@/features/chat/components/emoji-picker';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';
import { useEagerMediaUploads } from '@/features/discover/hooks/use-eager-media-uploads';
import { NoteMediaUploadRing } from '@/features/notes/components/NoteMediaUploadRing';
import { getApiErrorMessage } from '@/services/api/errors';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import {
  getMomentMentionedUserIds,
  insertMomentMention,
  MOMENT_MENTION_LIMIT,
  reconcileMomentMentionOccurrences,
  type MomentMentionOccurrence,
  type MomentTextSelection,
} from '@/features/discover/utils/moment-comment-mentions';
import { reportHandledFailure } from '@/observability/report-failure';

interface MomentCommentInputProps {
  replyTo: { id: string; nickname: string } | null;
  // onSubmit 可以返回 Promise；reject 时输入框保持打开（含已输入文本）让用户重试。
  // 仅在 resolve 时由父组件决定是否调用 onDismiss。
  onSubmit: (
    content: string,
    replyToId?: string,
    images?: string[],
    mentionedUserIds?: string[],
  ) => void | Promise<void>;
  onDismiss: () => void;
}

// 输入条下方的功能面板：表情选择 / @好友选择，同一时间只开一个。
type PanelKind = 'none' | 'emoji' | 'friends';

/** 选中即传(见 useEagerMediaUploads):写评论的同时图已经在传,点发送不用再等。 */
async function uploadCommentImage(asset: ImagePicker.ImagePickerAsset, progressKey: string): Promise<string> {
  const fileName = asset.fileName || asset.uri.split('/').pop() || 'photo.jpg';
  const contentType =
    resolveUploadContentType({ mimeType: asset.mimeType, fileName }) ?? 'image/jpeg';
  const prepared = await prepareChatImageForUpload({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    contentType,
    filename: fileName,
  });
  const presign = await requestUploadPresign({
    filename: sanitizeUploadFilename(prepared.filename),
    contentType: prepared.contentType,
    folder: 'posts',
    fileUri: prepared.uri,
  });
  await uploadLocalFileToPresignedUrl(
    presign.uploadUrl,
    prepared.contentType,
    prepared.uri,
    presign.requiredHeaders,
    undefined,
    { progressKey, foreground: true },
  );
  return presign.fileUrl;
}

function reportCommentImageUploadFailure(error: unknown) {
  reportHandledFailure('momentComment', 'imageUpload', error);
}

const s = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
  },
  backdrop: {
    flex: 1,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    height: 36,
    borderRadius: Radius.xxl,
    paddingHorizontal: Spacing.md,
    ...Typography.bodyRegular,
  },
  iconBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 已选图片预览条（输入行上方）
  imagePreviewRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  imagePreviewWrap: {
    position: 'relative',
  },
  imagePreview: {
    width: 64,
    height: 64,
    borderRadius: Radius.md,
  },
  imagePreviewClip: { borderRadius: Radius.md, overflow: 'hidden' },
  imageFailedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    maxHeight: 260,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  friendName: {
    ...Typography.bodyRegular,
  },
  panelHeader: {
    ...Typography.small,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  panelEmpty: {
    ...Typography.caption,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
});

export const MomentCommentInput: React.FC<MomentCommentInputProps> = ({
  replyTo,
  onSubmit,
  onDismiss,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 评论最多一张图:换图 = 删掉旧条目再加新的。传好的结果按条目记住,发送失败重试
  // 不重传 —— 每次重传 URL 都不同,评论的幂等键就对不上了。
  const {
    items: imageItems,
    add: addImage,
    remove: removeImage,
    retry: retryImage,
    settle: settleImage,
  } = useEagerMediaUploads({
    upload: uploadCommentImage,
    onError: reportCommentImageUploadFailure,
  });
  const image = imageItems[0] ?? null;
  const [panel, setPanel] = useState<PanelKind>('none');
  const [friends, setFriends] = useState<FriendProfile[] | null>(null);
  const [friendsError, setFriendsError] = useState(false);
  const [mentionOccurrences, setMentionOccurrences] = useState<
    MomentMentionOccurrence[]
  >([]);
  // 键盘弹起时它已盖住底部安全区——此时底部垫片必须归零，否则输入条和
  // 键盘之间会出现一段 34px 的空白。键盘收起才恢复安全区高度。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // 浮层随组件挂载一起打开：挂载即聚焦（Android 要等 Modal 窗口起来再聚焦）。
  useModalInputAutoFocus(inputRef, true);
  const selectionRef = useRef<MomentTextSelection>({ start: 0, end: 0 });
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () =>
      setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(hideEvent, () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const bottomInsetPad = keyboardVisible ? 0 : insets.bottom || Spacing.sm;

  const canSend = (text.trim().length > 0 || image !== null) && !submitting;

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    imageItems.forEach((item) => removeImage(item.id));
    addImage([result.assets[0]], 1);
  }, [addImage, imageItems, removeImage]);

  const handleToggleEmoji = useCallback(() => {
    setPanel((p) => (p === 'emoji' ? 'none' : 'emoji'));
  }, []);

  const handleToggleFriends = useCallback(() => {
    setPanel((p) => {
      const next = p === 'friends' ? 'none' : 'friends';
      return next;
    });
    // 懒加载好友列表：第一次展开时拉取。
    if (friends === null) {
      setFriendsError(false);
      fetchFriends()
        .then(setFriends)
        .catch((err) => {
          setFriendsError(true);
          reportHandledFailure('moments', 'fetchFriends', err);
        });
    }
  }, [friends]);

  const handleSelectEmoji = useCallback((emoji: string) => {
    setText((prev) => {
      const next = prev + emoji;
      selectionRef.current = { start: next.length, end: next.length };
      return next;
    });
  }, []);

  const handleTextChange = useCallback(
    (nextText: string) => {
      setMentionOccurrences((current) =>
        reconcileMomentMentionOccurrences(
          text,
          nextText,
          current,
          selectionRef.current,
        ),
      );
      setText(nextText);
    },
    [text],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = event.nativeEvent.selection;
    },
    [],
  );

  const handleMentionFriend = useCallback(
    (friend: FriendProfile) => {
      const next = insertMomentMention(text, mentionOccurrences, {
        userID: friend.id,
        nickname: friend.nickname,
      });
      if (next.limitReached) {
        Alert.alert(
          t('moment.mentionLimit', {
            count: MOMENT_MENTION_LIMIT,
            defaultValue: `最多只能提及 ${MOMENT_MENTION_LIMIT} 位好友`,
          }),
        );
        setPanel('none');
        inputRef.current?.focus();
        return;
      }
      setText(next.text);
      setMentionOccurrences(next.occurrences);
      selectionRef.current = {
        start: next.text.length,
        end: next.text.length,
      };
      setPanel('none');
      inputRef.current?.focus();
    },
    [mentionOccurrences, t, text],
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (
      (!trimmed && !image) ||
      submitting ||
      submitInFlightRef.current
    ) {
      return;
    }
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      let images: string[] | undefined;
      if (image) {
        // 图在选中时就开始传了,这里只等它传完;失败的会补传一次。
        const settled = await settleImage();
        if (!settled.ok) {
          // 上传阶段失败：onSubmit 还没发生，父组件不会提示，这里兜底。
          Alert.alert(
            t('discover.commentInput.imageUploadFailedTitle', {
              defaultValue: '图片上传失败',
            }),
            getApiErrorMessage(
              settled.error,
              t('moment.commentFailedMessage', {
                defaultValue: '网络异常，请稍后重试',
              }),
            ),
          );
          return;
        }
        images = settled.results;
      }

      try {
        const mentionedUserIds = getMomentMentionedUserIds(mentionOccurrences);
        await onSubmit(trimmed, replyTo?.id, images, mentionedUserIds);
        // onSubmit 成功后由父组件决定是否调用 onDismiss（一般会清掉 commentTarget）。
        setText('');
        if (image) removeImage(image.id);
        setMentionOccurrences([]);
        selectionRef.current = { start: 0, end: 0 };
      } catch {
        // 父组件已经处理过错误展示。这里只负责保留输入内容让用户重试。
      }
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [text, image, settleImage, removeImage, submitting, replyTo, onSubmit, t, mentionOccurrences]);

  const renderFriendRow = useCallback(
    ({ item }: { item: FriendProfile }) => (
      <Pressable
        style={s.friendRow}
        onPress={() => handleMentionFriend(item)}
      >
        <Avatar size={32} name={item.nickname} uri={item.avatarUrl ?? undefined} />
        <Text style={[s.friendName, { color: colors.text }]}>
          {item.nickname}
        </Text>
      </Pressable>
    ),
    [colors.text, handleMentionFriend],
  );

  return (
    // 透明 Modal 让浮层挂到窗口层：避让容器的 padding 是按相对父容器的坐标算的，
    // 宿主若不是全屏（如信息流页上方还有标题/tab），输入条会被顶进键盘底下。
    // Modal 内坐标恒等于全屏，详情页/信息流共用同一行为。
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingContainer style={s.overlay}>
        {/* Tap backdrop to dismiss */}
        <Pressable style={s.backdrop} onPress={onDismiss} />

        {/* 已选图片预览 */}
        {image ? (
          <View
            style={[s.imagePreviewRow, { backgroundColor: colors.surface }]}
          >
            <View style={s.imagePreviewWrap}>
              <View style={s.imagePreviewClip}>
                <Image
                  source={{ uri: image.asset.uri }}
                  style={s.imagePreview}
                  contentFit="cover"
                />
                {image.status === 'uploading' ? <NoteMediaUploadRing progressKey={image.id} /> : null}
                {image.status === 'failed' ? (
                  <Pressable
                    style={[s.imageFailedOverlay, { backgroundColor: colors.overlay }]}
                    onPress={() => retryImage(image.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.retry')}
                  >
                    <Ionicons name="refresh" size={20} color={colors.white} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                style={[s.imageRemoveBtn, { backgroundColor: colors.text }]}
                onPress={() => removeImage(image.id)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t('common.delete', { defaultValue: '删除' })}
              >
                <Ionicons name="close" size={12} color={colors.background} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Input bar */}
        <View
          style={[
            s.container,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.divider,
            },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={handleTextChange}
            onSelectionChange={handleSelectionChange}
            placeholder={
              replyTo
                ? t('discover.commentInput.replyTo', {
                    nickname: replyTo.nickname,
                    defaultValue: `回复 ${replyTo.nickname}`,
                  })
                : t('discover.commentInput.placeholder', {
                    defaultValue: '写评论...',
                  })
            }
            placeholderTextColor={colors.textSecondary}
            autoFocus={MODAL_INPUT_NATIVE_AUTO_FOCUS}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            style={[
              s.input,
              { backgroundColor: colors.background, color: colors.text },
            ]}
          />
          <Pressable
            style={s.iconBtn}
            onPress={handlePickImage}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('discover.commentInput.pickImage', {
              defaultValue: '添加图片',
            })}
          >
            <Ionicons name="image-outline" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            style={s.iconBtn}
            onPress={handleToggleFriends}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('discover.commentInput.mention', {
              defaultValue: '提到好友',
            })}
          >
            <Ionicons
              name="at"
              size={22}
              color={panel === 'friends' ? colors.iconAccent : colors.textSecondary}
            />
          </Pressable>
          <Pressable
            style={s.iconBtn}
            onPress={handleToggleEmoji}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('discover.commentInput.emoji', {
              defaultValue: '表情',
            })}
          >
            <Ionicons
              name="happy-outline"
              size={22}
              color={panel === 'emoji' ? colors.iconAccent : colors.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            style={[
              s.sendBtn,
              {
                backgroundColor: canSend ? colors.primary : colors.surfaceBorder,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="send" size={16} color={colors.white} />
            )}
          </Pressable>
        </View>

        {/* 表情面板 */}
        {panel === 'emoji' ? (
          <View style={{ backgroundColor: colors.background }}>
            <EmojiPicker onSelect={handleSelectEmoji} />
          </View>
        ) : null}

        {/* @好友面板 */}
        {panel === 'friends' ? (
          <View style={[s.panel, { backgroundColor: colors.background }]}>
            <Text style={[s.panelHeader, { color: colors.textSecondary }]}>
              {t('discover.commentInput.mentionTitle', {
                defaultValue: '选择提醒的好友',
              })}
            </Text>
            {friends === null && !friendsError ? (
              <ActivityIndicator
                style={{ paddingVertical: Spacing.lg }}
                color={colors.iconAccent}
              />
            ) : friendsError ? (
              <Text style={[s.panelEmpty, { color: colors.textSecondary }]}>
                {t('discover.commentInput.friendsLoadFailed', {
                  defaultValue: '好友加载失败',
                })}
              </Text>
            ) : friends && friends.length === 0 ? (
              <Text style={[s.panelEmpty, { color: colors.textSecondary }]}>
                {t('discover.commentInput.noFriends', {
                  defaultValue: '暂无好友',
                })}
              </Text>
            ) : (
              <FlatList
                data={friends ?? []}
                initialNumToRender={MOMENT_MENTION_LIMIT + 1}
                keyExtractor={(item) => item.id}
                renderItem={renderFriendRow}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </View>
        ) : null}

        {/* 底部垫片：键盘弹起时归零（贴紧键盘），键盘收起才补安全区高度。 */}
        <View
          style={{
            backgroundColor:
              panel === 'none' ? colors.surface : colors.background,
            height: bottomInsetPad,
          }}
        />
      </KeyboardAvoidingContainer>
      <UploadProgressHost />
    </Modal>
  );
};
