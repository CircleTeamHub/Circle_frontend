import { useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  StyleSheet,
  SectionListData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { Spacing, Typography, useTheme } from '@/theme';

interface GroupItem {
  id: string;
  name: string;
  memberCount: number;
  description: string;
}

interface GroupSection {
  title: string;
  data: GroupItem[];
}

const GROUP_SECTIONS: GroupSection[] = [
  {
    title: '我创建的群聊',
    data: [
      { id: 'created-1', name: 'Circle 产品讨论群', memberCount: 28, description: '产品迭代、版本计划和需求同步' },
      { id: 'created-2', name: '周末羽毛球局', memberCount: 16, description: '每周活动报名和场地协调' },
    ],
  },
  {
    title: '我加入的群聊',
    data: [
      { id: 'joined-1', name: '前端开发交流群', memberCount: 84, description: 'RN / Expo / Web 技术交流' },
      { id: 'joined-2', name: '深圳同城饭搭子', memberCount: 43, description: '工作日约饭和周末探店' },
    ],
  },
  {
    title: '我管理的群聊',
    data: [
      { id: 'managed-1', name: '运营值班群', memberCount: 12, description: '日常排班和异常处理' },
    ],
  },
];

const s = StyleSheet.create({
  sectionHeader: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  groupBody: {
    flex: 1,
    gap: Spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
});

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      listContent: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      groupName: {
        color: colors.text,
        fontSize: 15,
        fontWeight: '600' as const,
        flex: 1,
        marginRight: Spacing.sm,
      },
      memberCount: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      description: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
        paddingTop: Spacing.xl,
      },
    }),
    [colors, insets.bottom],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="群聊" />
      <SectionList
        sections={GROUP_SECTIONS}
        keyExtractor={(item) => item.id}
        contentContainerStyle={d.listContent}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }: { section: SectionListData<GroupItem, GroupSection> }) => (
          <View style={s.sectionHeader}>
            <Text style={d.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View>
            <Pressable style={s.groupRow}>
              <Avatar size={40} name={item.name} />
              <View style={s.groupBody}>
                <View style={s.topRow}>
                  <Text style={d.groupName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={d.memberCount}>{item.memberCount}人</Text>
                </View>
                <Text style={d.description} numberOfLines={1}>
                  {item.description}
                </Text>
              </View>
            </Pressable>
            {index < section.data.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={<Text style={d.emptyText}>暂无群聊</Text>}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
