import {
  type PanResponderInstance,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { chatDetailStyles as s } from '@/features/chat/chat-detail/styles';
import { Spacing, type ThemeColors } from '@/theme';
import {
  ATTACHMENT_PAGES,
  type AttachmentId,
} from '@/features/chat/chat-detail/constants';
import { Ionicons } from '@expo/vector-icons';
import { type EdgeInsets } from 'react-native-safe-area-context';
import { type TFunction } from 'i18next';
import {
  type ChatDetailThemedStyles,
} from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { type Dispatch, type SetStateAction } from 'react';

export interface AttachmentPanelProps {
  insets: EdgeInsets;
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  windowWidth: number;
  d: ChatDetailThemedStyles;
  callStarting: boolean;
  attachmentOpen: boolean;
  attachmentPage: number;
  setAttachmentPage: Dispatch<SetStateAction<number>>;
  attachmentPagerWidth: number;
  setAttachmentPagerWidth: Dispatch<SetStateAction<number>>;
  attachmentPanResponder: PanResponderInstance;
  handleAttachmentAction: (id: AttachmentId) => void;
}

/**
 * 「+」工具面板:按页横向排布的入口(每页 4×2),底部页码点,顶部把手可下拉收起。
 */
export function AttachmentPanel({
  insets,
  colors,
  t,
  windowWidth,
  d,
  callStarting,
  attachmentOpen,
  attachmentPage,
  setAttachmentPage,
  attachmentPagerWidth,
  setAttachmentPagerWidth,
  attachmentPanResponder,
  handleAttachmentAction,
}: AttachmentPanelProps) {
  return attachmentOpen ? (
    <View
      style={[
        s.attachmentPanel,
        d.attachmentPanel,
        { paddingBottom: insets.bottom || Spacing.md },
      ]}
      {...attachmentPanResponder.panHandlers}
    >
      <View style={s.attachmentDragHandle}>
        <View style={[s.attachmentDragBar, d.attachmentDragBar]} />
      </View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={ATTACHMENT_PAGES.length > 1}
        onLayout={(e) => setAttachmentPagerWidth(e.nativeEvent.layout.width)}
        onMomentumScrollEnd={(e) => {
          const w = attachmentPagerWidth || windowWidth - Spacing.md * 2;
          if (w > 0) {
            setAttachmentPage(Math.round(e.nativeEvent.contentOffset.x / w));
          }
        }}
      >
        {ATTACHMENT_PAGES.map((page, pageIndex) => (
          <View
            key={pageIndex}
            style={[
              s.attachmentGrid,
              { width: attachmentPagerWidth || windowWidth - Spacing.md * 2 },
            ]}
          >
            {page.map((item) => (
              <Pressable
                key={item.id}
                style={s.attachmentItem}
                onPress={() => handleAttachmentAction(item.id)}
                disabled={item.id === 'voice-call' && callStarting}
              >
                <View style={[s.attachmentIcon, d.attachmentIcon]}>
                  <Ionicons
                    name={item.icon}
                    size={26}
                    color={
                      item.id === 'voice-call' && callStarting
                        ? colors.iconAccent
                        : colors.text
                    }
                  />
                </View>
                <Text
                  style={[s.attachmentLabel, { color: colors.textSecondary }]}
                >
                  {item.id === 'voice-call' && callStarting
                    ? t('chat.call.calling', { defaultValue: '呼叫中' })
                    : t(item.labelKey, { defaultValue: item.label })}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      {ATTACHMENT_PAGES.length > 1 ? (
        <View style={s.attachmentDots}>
          {ATTACHMENT_PAGES.map((_, i) => (
            <View
              key={i}
              style={[
                s.attachmentDot,
                {
                  backgroundColor:
                    i === attachmentPage
                      ? colors.primary
                      : colors.surfaceBorder,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  ) : null;
}
