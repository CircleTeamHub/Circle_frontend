import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { EmojiPicker } from '@/features/chat/components/emoji-picker';
import { getApiErrorMessage } from '@/services/api/errors';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import {
  getMentionedUserIds,
  selectMentionTarget,
  type MentionTarget,
} from '@/features/chat/utils/chat-send-payloads';

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
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKind>('none');
  const [friends, setFriends] = useState<FriendProfile[] | null>(null);
  const [friendsError, setFriendsError] = useState(false);
  const [mentionTargets, setMentionTargets] = useState<MentionTarget[]>([]);
  // 键盘弹起时它已盖住底部安全区——此时底部垫片必须归零，否则输入条和
  // 键盘之间会出现一段 34px 的空白。键盘收起才恢复安全区高度。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

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

  const canSend = (text.trim().length > 0 || imageUri !== null) && !submitting;

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setImageUri(result.assets[0].uri);
  }, []);

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
          if (__DEV__) {
            console.warn('[MomentCommentInput] fetchFriends failed', err);
          }
        });
    }
  }, [friends]);

  const handleSelectEmoji = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
  }, []);

  const handleMentionFriend = useCallback((friend: FriendProfile) => {
    // 插到末尾并补空格，和抖音一致；@ 之前若无空格补一个。
    setText((prev) =>
      `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${friend.nickname} `,
    );
    setMentionTargets((current) =>
      selectMentionTarget(current, {
        userID: friend.id,
        nickname: friend.nickname,
      }),
    );
    setPanel('none');
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && !imageUri) || submitting) return;
    setSubmitting(true);
    try {
      let images: string[] | undefined;
      if (imageUri) {
        try {
          const fileName = imageUri.split('/').pop() ?? 'photo.jpg';
          const contentType =
            resolveUploadContentType({ fileName }) ?? 'image/jpeg';
          const presign = await requestUploadPresign({
            filename: sanitizeUploadFilename(fileName),
            contentType,
            folder: 'posts',
          });
          await uploadLocalFileToPresignedUrl(
            presign.uploadUrl,
            contentType,
            imageUri,
          );
          images = [presign.fileUrl];
        } catch (error) {
          // 上传阶段失败：onSubmit 还没发生，父组件不会提示，这里兜底。
          Alert.alert(
            t('discover.commentInput.imageUploadFailedTitle', {
              defaultValue: '图片上传失败',
            }),
            getApiErrorMessage(
              error,
              t('moment.commentFailedMessage', {
                defaultValue: '网络异常，请稍后重试',
              }),
            ),
          );
          return;
        }
      }

      try {
        const mentionedUserIds = getMentionedUserIds(
          trimmed,
          mentionTargets,
        );
        await onSubmit(trimmed, replyTo?.id, images, mentionedUserIds);
        // onSubmit 成功后由父组件决定是否调用 onDismiss（一般会清掉 commentTarget）。
        setText('');
        setImageUri(null);
        setMentionTargets([]);
      } catch {
        // 父组件已经处理过错误展示。这里只负责保留输入内容让用户重试。
      }
    } finally {
      setSubmitting(false);
    }
  }, [text, imageUri, submitting, replyTo, onSubmit, t, mentionTargets]);

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
    // 透明 Modal 让浮层挂到窗口层：KeyboardAvoidingView 的 padding 是按相对
    // 父容器的坐标算的，宿主若不是全屏（如信息流页上方还有标题/tab），输入条
    // 会被顶进键盘底下。Modal 内坐标恒等于全屏，详情页/信息流共用同一行为。
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Tap backdrop to dismiss */}
        <Pressable style={s.backdrop} onPress={onDismiss} />

        {/* 已选图片预览 */}
        {imageUri ? (
          <View
            style={[s.imagePreviewRow, { backgroundColor: colors.surface }]}
          >
            <View style={s.imagePreviewWrap}>
              <Image
                source={{ uri: imageUri }}
                style={s.imagePreview}
                contentFit="cover"
              />
              <Pressable
                style={[s.imageRemoveBtn, { backgroundColor: colors.text }]}
                onPress={() => setImageUri(null)}
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
            onChangeText={setText}
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
            autoFocus
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
              color={panel === 'friends' ? colors.primary : colors.textSecondary}
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
              color={panel === 'emoji' ? colors.primary : colors.textSecondary}
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
                color={colors.primary}
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
      </KeyboardAvoidingView>
    </Modal>
  );
};
