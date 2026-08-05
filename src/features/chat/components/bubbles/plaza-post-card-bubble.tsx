import {
  View,
  Text,
  StyleSheet,
  Pressable,
  type GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import type { ChatMessage, PlazaPostCardData } from '@/types';
import { AVATAR_SIZE, CardBubbleFrame } from './shared';

interface PlazaPostCardBubbleProps {
  message: ChatMessage;
  outgoing: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress?: (card: PlazaPostCardData) => void;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  hideStatus?: boolean;
}

// 海报卡宽度与封面高度（2:1）。刻意比名片/圈子卡（260 紧凑气泡）更「像一张传单」。
const POSTER_WIDTH = 264;
const COVER_HEIGHT = 132;

// 无封面图时的默认封面图：app 品牌纸飞机（透明底 logo，直接居中，不带图标外框）。
const PLANE_LOGO = require('../../../../../assets/images/login-logo-plane.png');

// 封面上的固定视觉：深色玻璃底 + 纯白字/图标，在真实图片或默认图上都清晰，
// 因此不随明暗主题变化（与 friend-card 里「气泡上的固定白」同一处理）。
const GLASS_DARK = 'rgba(0,0,0,0.55)';
const GLASS_DARKER = 'rgba(0,0,0,0.5)';
const ON_COVER = '#FFFFFF';

const s = StyleSheet.create({
  body: { maxWidth: POSTER_WIDTH },
  card: {
    width: POSTER_WIDTH,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  // 封面：顶部放「活动」角标、底部放圈子归属 chip，中间被封面图/渐变填充。
  cover: {
    height: COVER_HEIGHT,
    justifyContent: 'space-between',
  },
  coverImage: StyleSheet.absoluteFillObject,
  coverFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  coverFallbackPlane: {
    width: 84,
    height: 84,
  },
  coverRowTop: {
    flexDirection: 'row',
    padding: Spacing.sm,
  },
  coverRowBottom: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: GLASS_DARK,
  },
  badgeText: {
    ...Typography.tiny,
    color: ON_COVER,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '80%',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: GLASS_DARKER,
  },
  circleChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: ON_COVER,
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: Spacing.sm + Spacing.xs,
    paddingVertical: Spacing.sm + 2,
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    ...Typography.small,
    flexShrink: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 1,
  },
  signupInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 1,
  },
  signupText: {
    ...Typography.small,
    fontWeight: '600',
    flexShrink: 1,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '700',
    color: ON_COVER,
  },
});

// 圈子广场帖分享卡 —— 海报式布局：顶部封面 + 玻璃角标/圈子归属，底部报名热度 + CTA。
// 刻意区别于名片卡（静态身份气泡）与圈子卡（组织气泡）：用 surface 内容卡底而非
// 紫气泡，用大封面而非小图标，把「可报名」这一动作显性化。点击打开帖子详情
// （详情页负责实时拉取 + 已删除/过期兜底）。
export const PlazaPostCardBubble: React.FC<PlazaPostCardBubbleProps> = ({
  message,
  outgoing,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
  onAvatarPress,
  onLongPress,
  hideStatus,
}) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const card = message.plazaPostCard;

  if (!card) return null;

  const coverUrl = card.coverUrl;

  const avatarNode = (
    <Avatar
      size={AVATAR_SIZE}
      shape="square"
      name={outgoing ? selfName : senderName}
      uri={outgoing ? selfAvatarUri : senderAvatarUri}
    />
  );

  const authorLine = t('chat.plazaPostCard.by', {
    author: card.authorNickname,
    defaultValue: '由 {{author}} 发起',
  });
  const signupText =
    card.signupCount > 0
      ? t('chat.plazaPostCard.signupCount', {
          count: card.signupCount,
          defaultValue: '{{count}} 人已报名',
        })
      : t('chat.plazaPostCard.signupEmpty', {
          defaultValue: '还没有人报名，来当第一个',
        });

  return (
    <CardBubbleFrame
      message={message}
      outgoing={outgoing}
      avatarNode={avatarNode}
      onAvatarPress={onAvatarPress}
      hideStatus={hideStatus}
      bodyStyle={s.body}
    >
      <Pressable
        style={[
          s.card,
          { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
        ]}
        onPress={onPress ? () => onPress(card) : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
      >
        {/* 封面区：有图显图；无图回落白底 + 居中 app 品牌纸飞机。 */}
        <View style={s.cover}>
          {coverUrl ? (
            <Image
              source={{ uri: coverUrl }}
              style={s.coverImage}
              contentFit="cover"
              // 封面来自对端可控的卡片 payload；理由同 image-bubble。
              enforceEarlyResizing
              recyclingKey={coverUrl}
            />
          ) : (
            <View
              style={[
                s.coverFallback,
                {
                  backgroundColor: colors.white,
                  borderBottomColor: colors.divider,
                },
              ]}
            >
              <Image
                source={PLANE_LOGO}
                style={s.coverFallbackPlane}
                contentFit="contain"
              />
            </View>
          )}

          <View style={s.coverRowTop}>
            <View style={s.badge}>
              <Ionicons name="sparkles" size={11} color={ON_COVER} />
              <Text style={s.badgeText}>
                {t('chat.plazaPostCard.badge', { defaultValue: '活动' })}
              </Text>
            </View>
          </View>

          <View style={s.coverRowBottom}>
            <View style={s.circleChip}>
              <Ionicons name="people" size={11} color={ON_COVER} />
              <Text style={s.circleChipText} numberOfLines={1}>
                {card.circleName}
              </Text>
            </View>
          </View>
        </View>

        {/* 内容区：标题 + 城市/发起人 meta + 报名热度行 + 去报名 CTA。 */}
        <View style={s.content}>
          <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>
            {card.title}
          </Text>

          <View style={s.metaRow}>
            {card.city ? (
              <>
                <Ionicons
                  name="location-outline"
                  size={12}
                  color={colors.textSecondary}
                />
                <Text
                  style={[s.metaText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {card.city}
                </Text>
                <Text style={[s.metaText, { color: colors.textSecondary }]}>
                  ·
                </Text>
              </>
            ) : null}
            <Text
              style={[s.metaText, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {authorLine}
            </Text>
          </View>

          <View style={[s.divider, { backgroundColor: colors.divider }]} />

          <View style={s.signupRow}>
            <View style={s.signupInfo}>
              <Ionicons name="flame" size={13} color={colors.primary} />
              <Text
                style={[s.signupText, { color: colors.primary }]}
                numberOfLines={1}
              >
                {signupText}
              </Text>
            </View>
            <View style={[s.cta, { backgroundColor: colors.primary }]}>
              <Text style={s.ctaText}>
                {t('chat.plazaPostCard.cta', { defaultValue: '去报名' })}
              </Text>
              <Ionicons name="arrow-forward" size={12} color={ON_COVER} />
            </View>
          </View>
        </View>
      </Pressable>
    </CardBubbleFrame>
  );
};
