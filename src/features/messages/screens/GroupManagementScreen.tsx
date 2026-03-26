import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useMessageGroupsStore } from '@/features/messages/store/use-message-groups-store';

export default function GroupManagementScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [groupName, setGroupName] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const conversations = useMessageGroupsStore((state) => state.conversations);
  const customGroups = useMessageGroupsStore((state) => state.customGroups);
  const addCustomGroup = useMessageGroupsStore((state) => state.addCustomGroup);
  const toggleConversationInCustomGroup = useMessageGroupsStore(
    (state) => state.toggleConversationInCustomGroup,
  );

  const groupConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) => conversation.conversationType === 'group',
      ),
    [conversations],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        content: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
          gap: Spacing.xl,
        },
        section: {
          gap: Spacing.sm,
        },
        sectionTitle: {
          color: colors.textSecondary,
          ...Typography.caption,
          fontWeight: '600',
        },
        inputRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.md,
        },
        input: {
          flex: 1,
          height: 44,
          borderRadius: Radius.lg,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
          backgroundColor: colors.surface,
          paddingHorizontal: Spacing.md,
          color: colors.text,
          ...Typography.bodyRegular,
        },
        createButton: {
          height: 44,
          paddingHorizontal: Spacing.lg,
          borderRadius: Radius.lg,
          backgroundColor: colors.primary,
          justifyContent: 'center',
          alignItems: 'center',
        },
        createButtonText: {
          color: colors.white,
          ...Typography.body,
          fontWeight: '600',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: Spacing.md,
          paddingVertical: Spacing.md,
        },
        rowLabel: {
          color: colors.text,
          ...Typography.body,
          flex: 1,
        },
        rowRight: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
        },
        rowValue: {
          color: colors.textSecondary,
          ...Typography.caption,
        },
      }),
    [colors, insets.bottom],
  );

  const handleCreateGroup = useCallback(() => {
    const createdId = addCustomGroup(groupName);

    if (createdId) {
      setActiveGroupId(createdId);
      setGroupName('');
    }
  }, [addCustomGroup, groupName]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="群组管理" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>创建自定义群组</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="例如：北京群"
              placeholderTextColor={colors.textSecondary}
            />
            <Pressable style={styles.createButton} onPress={handleCreateGroup}>
              <Text style={styles.createButtonText}>创建</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>我的自定义群组</Text>
          {customGroups.map((group, index) => {
            const count = groupConversations.filter((conversation) =>
              (conversation.customGroupIds ?? []).includes(group.id),
            ).length;

            return (
              <View key={group.id}>
                <Pressable
                  style={styles.row}
                  onPress={() => setActiveGroupId(group.id)}
                >
                  <Text style={styles.rowLabel}>{group.name}</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.rowValue}>{count} 个群聊</Text>
                    <Ionicons
                      name={
                        activeGroupId === group.id
                          ? 'checkmark-circle'
                          : 'ellipse-outline'
                      }
                      size={18}
                      color={
                        activeGroupId === group.id
                          ? colors.primary
                          : colors.textSecondary
                      }
                    />
                  </View>
                </Pressable>
                {index < customGroups.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </View>

        {activeGroupId ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>分配群聊到当前群组</Text>
            {groupConversations.map((conversation, index) => {
              const checked = (conversation.customGroupIds ?? []).includes(
                activeGroupId,
              );

              return (
                <View key={conversation.id}>
                  <Pressable
                    style={styles.row}
                    onPress={() =>
                      toggleConversationInCustomGroup(
                        activeGroupId,
                        conversation.id,
                      )
                    }
                  >
                    <Text style={styles.rowLabel}>{conversation.name}</Text>
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={checked ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  {index < groupConversations.length - 1 ? <Divider /> : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
