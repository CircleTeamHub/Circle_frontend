import { useCallback, useMemo, useState } from 'react';
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

const s = StyleSheet.create({
  section: {
    gap: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});

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

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      content: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
        gap: Spacing.xl,
      },
      sectionTitle: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
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
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
      },
      createButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
      rowLabel: {
        color: colors.text,
        ...Typography.body,
        flex: 1,
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
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="群组管理" />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.section}>
          <Text style={d.sectionTitle}>创建自定义群组</Text>
          <View style={s.inputRow}>
            <TextInput
              style={d.input}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="例如：北京群"
              placeholderTextColor={colors.textSecondary}
            />
            <Pressable style={d.createButton} onPress={handleCreateGroup}>
              <Text style={d.createButtonText}>创建</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.section}>
          <Text style={d.sectionTitle}>我的自定义群组</Text>
          {customGroups.map((group, index) => {
            const count = groupConversations.filter((conversation) =>
              (conversation.customGroupIds ?? []).includes(group.id),
            ).length;

            return (
              <View key={group.id}>
                <Pressable
                  style={s.row}
                  onPress={() => setActiveGroupId(group.id)}
                >
                  <Text style={d.rowLabel}>{group.name}</Text>
                  <View style={s.rowRight}>
                    <Text style={d.rowValue}>{count} 个群聊</Text>
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
          <View style={s.section}>
            <Text style={d.sectionTitle}>分配群聊到当前群组</Text>
            {groupConversations.map((conversation, index) => {
              const checked = (conversation.customGroupIds ?? []).includes(
                activeGroupId,
              );

              return (
                <View key={conversation.id}>
                  <Pressable
                    style={s.row}
                    onPress={() =>
                      toggleConversationInCustomGroup(
                        activeGroupId,
                        conversation.id,
                      )
                    }
                  >
                    <Text style={d.rowLabel}>{conversation.name}</Text>
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
