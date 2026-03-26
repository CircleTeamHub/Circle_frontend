import React, { useCallback, useMemo } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Spacing, Typography, Radius } from '@/theme';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { DatePill, ReceivedBubble, SentBubble, LocationCard } from '@/features/chat/components/chat-bubble';
import { getUserProfileHref } from '@/features/user/utils/routes';
import type { ChatMessage } from '@/types';

const MESSAGES: ChatMessage[] = [
  { id: '1', type: 'date', text: '今天' },
  { id: '2', type: 'received', text: '嘿！你今晚来参加聚会吗？🎉', time: '下午 2:30' },
  { id: '3', type: 'sent', text: '来！几点开始？', time: '下午 2:32' },
  { id: '4', type: 'received', text: '晚上7点在市中心的天台酒吧。我把位置发给你 📍', time: '下午 2:33' },
  { id: '5', type: 'sent', text: '太棒了！等不及了 🙌', time: '下午 2:34' },
  { id: '6', type: 'location', locationTitle: '天际线天台酒吧', locationAddress: '市中心大道123号，32层', time: '下午 2:35' },
];

export default function ChatDetailScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const handleBack = useCallback(() => router.back(), []);
  const handleOpenUserProfile = useCallback(() => {
    router.push(getUserProfileHref('messages', 'chen-siqi', '陈思琪'));
  }, []);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.md },
    headerInfo: { flex: 1 },
    headerName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    onlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.online },
    onlineText: { color: colors.textSecondary, ...Typography.small },
    messageList: { padding: Spacing.md, gap: 14 },
    inputBar: { backgroundColor: colors.background, paddingTop: 10, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 10 },
    circleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    textInputWrap: { flex: 1, height: 40, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: Radius.xl, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
    textInput: { flex: 1, color: colors.text, ...Typography.bodyRegular, padding: 0 },
  }), [colors]);

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    switch (item.type) {
      case 'date': return <DatePill text={item.text ?? ''} />;
      case 'received':
        return (
          <ReceivedBubble
            message={item}
            senderName="陈思琪"
            onAvatarPress={handleOpenUserProfile}
          />
        );
      case 'sent': return <SentBubble message={item} />;
      case 'location':
        return (
          <LocationCard
            message={item}
            senderName="陈思琪"
            onAvatarPress={handleOpenUserProfile}
          />
        );
      default: return null;
    }
  }, [handleOpenUserProfile]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => router.push(getUserProfileHref('messages', 'chen-siqi', '陈思琪'))}
        >
          <Avatar size={40} name="陈思琪" />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>陈思琪</Text>
          <View style={styles.onlineRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>在线</Text>
          </View>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => router.push('/(tabs)/messages/chat-info')}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <Divider />
      <FlatList
        data={MESSAGES}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
      />
      <Divider />
      <View style={[styles.inputBar, { paddingBottom: insets.bottom || 28 }]}>
        <Pressable style={styles.circleBtn}>
          <Ionicons name="mic" size={18} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.textInputWrap}>
          <TextInput style={styles.textInput} placeholder="输入消息..." placeholderTextColor={colors.textSecondary} />
          <Ionicons name="happy-outline" size={18} color={colors.textSecondary} />
        </View>
        <Pressable style={styles.circleBtn}>
          <Ionicons name="add" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}
