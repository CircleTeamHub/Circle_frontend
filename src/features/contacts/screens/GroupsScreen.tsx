import { useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  StyleSheet,
  SectionListData,
} from 'react-native';
import { useTranslation } from 'react-i18next';
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

interface GroupSectionSeed {
  titleKey: string;
  data: Array<GroupItem & { nameKey: string; descriptionKey: string }>;
}

const GROUP_SECTIONS: GroupSectionSeed[] = [
  {
    titleKey: 'contacts.groupsScreen.myCreated',
    data: [
      {
        id: 'created-1',
        name: '',
        nameKey: 'contacts.groupsScreen.samples.createdProduct.name',
        memberCount: 28,
        description: '',
        descriptionKey: 'contacts.groupsScreen.samples.createdProduct.description',
      },
      {
        id: 'created-2',
        name: '',
        nameKey: 'contacts.groupsScreen.samples.createdSports.name',
        memberCount: 16,
        description: '',
        descriptionKey: 'contacts.groupsScreen.samples.createdSports.description',
      },
    ],
  },
  {
    titleKey: 'contacts.groupsScreen.myJoined',
    data: [
      {
        id: 'joined-1',
        name: '',
        nameKey: 'contacts.groupsScreen.samples.joinedFrontend.name',
        memberCount: 84,
        description: '',
        descriptionKey: 'contacts.groupsScreen.samples.joinedFrontend.description',
      },
      {
        id: 'joined-2',
        name: '',
        nameKey: 'contacts.groupsScreen.samples.joinedDining.name',
        memberCount: 43,
        description: '',
        descriptionKey: 'contacts.groupsScreen.samples.joinedDining.description',
      },
    ],
  },
  {
    titleKey: 'contacts.groupsScreen.myManaged',
    data: [
      {
        id: 'managed-1',
        name: '',
        nameKey: 'contacts.groupsScreen.samples.managedOps.name',
        memberCount: 12,
        description: '',
        descriptionKey: 'contacts.groupsScreen.samples.managedOps.description',
      },
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
  const { t } = useTranslation();

  const sections = useMemo(
    () =>
      GROUP_SECTIONS.map((section) => ({
        title: t(section.titleKey),
        data: section.data.map((item) => ({
          id: item.id,
          name: t(item.nameKey),
          memberCount: item.memberCount,
          description: t(item.descriptionKey),
        })),
      })),
    [t],
  );

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
      <NavHeader title={t('contacts.groupsScreen.title')} />
      <SectionList
        sections={sections}
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
                  <Text style={d.memberCount}>
                    {t('contacts.groupsScreen.memberCount', { count: item.memberCount })}
                  </Text>
                </View>
                <Text style={d.description} numberOfLines={1}>
                  {item.description}
                </Text>
              </View>
            </Pressable>
            {index < section.data.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={<Text style={d.emptyText}>{t('contacts.groupsScreen.empty')}</Text>}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
