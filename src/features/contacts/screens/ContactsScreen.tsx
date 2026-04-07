import { Avatar } from "@/components/ui/avatar";
import { Divider } from "@/components/ui/divider";
import { MenuRow } from "@/components/ui/menu-row";
import { SearchBar } from "@/components/ui/search-bar";
import { getUserProfileIdByName } from "@/features/user/data/profiles";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { Spacing, Typography, useTheme } from "@/theme";
import type { Contact, ContactSection } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  Pressable,
  SectionList,
  SectionListData,
  SectionListRenderItemInfo,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const QUICK_ACTIONS: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  iconBg: string;
}[] = [
  { icon: "person-add", label: "新的朋友", iconBg: "#F97316" },
  { icon: "chatbubble", label: "坐席", iconBg: "#3B82F6" },
  { icon: "chatbubbles", label: "群聊", iconBg: "#22C55E" },
  { icon: "pricetag", label: "标签", iconBg: "#A855F7" },
  //{ icon: 'newspaper', label: '公众号', iconBg: '#6366F1' },
];

const CONTACT_SECTIONS: ContactSection[] = [
  {
    letter: "A",
    data: [
      { id: "a1", name: "阿古达木" },
      { id: "a2", name: "阿卡迪亚" },
      { id: "a3", name: "安琪" },
    ],
  },
  {
    letter: "B",
    data: [
      { id: "b1", name: "白小飞" },
      { id: "b2", name: "毕雯雯" },
    ],
  },
  {
    letter: "C",
    data: [
      { id: "c1", name: "陈思琪" },
      { id: "c2", name: "陈明" },
      { id: "c3", name: "程浩宇" },
    ],
  },
  {
    letter: "D",
    data: [
      { id: "d1", name: "邓紫棋" },
      { id: "d2", name: "杜若溪" },
    ],
  },
  {
    letter: "F",
    data: [
      { id: "f1", name: "范小勤" },
      { id: "f2", name: "冯绍峰" },
    ],
  },
  {
    letter: "G",
    data: [
      { id: "g1", name: "高圆圆" },
      { id: "g2", name: "郭敬明" },
    ],
  },
  {
    letter: "H",
    data: [
      { id: "h1", name: "韩梅梅" },
      { id: "h2", name: "何炅" },
      { id: "h3", name: "黄晓明" },
    ],
  },
  {
    letter: "J",
    data: [
      { id: "j1", name: "贾玲" },
      { id: "j2", name: "金晨" },
    ],
  },
  {
    letter: "L",
    data: [
      { id: "l1", name: "李晓婷" },
      { id: "l2", name: "刘雨欣" },
      { id: "l3", name: "林美琪" },
      { id: "l4", name: "罗敏" },
    ],
  },
  {
    letter: "W",
    data: [
      { id: "w1", name: "王浩然" },
      { id: "w2", name: "吴佳怡" },
      { id: "w3", name: "魏大勋" },
    ],
  },
  {
    letter: "Z",
    data: [
      { id: "z1", name: "张明远" },
      { id: "z2", name: "赵天宇" },
      { id: "z3", name: "周子涵" },
      { id: "z4", name: "郑小雨" },
    ],
  },
];

const ALPHABET = "ABCDEFGHIJKLM#".split("");

const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
  },
  headerSection: {
    gap: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quickActions: {
    marginBottom: Spacing.sm,
  },
  sectionHeader: {
    paddingVertical: Spacing.sm,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: 14,
  },
  alphabetIndex: {
    position: "absolute",
    right: 4,
    width: 14,
    justifyContent: "center",
    alignItems: "center",
    gap: 1,
  },
});

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      title: {
        color: colors.text,
        ...Typography.title,
      },
      sectionLetter: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: "600" as const,
      },
      contactName: {
        color: colors.text,
        fontSize: 15,
        fontWeight: "500" as const,
      },
      alphabetLetter: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
    }),
    [colors],
  );

  const handleAddFriend = useCallback(() => {
    router.push("/(tabs)/contacts/add-friend");
  }, [router]);

  const handleOpenSearch = useCallback(() => {
    router.push("/(tabs)/contacts/search");
  }, [router]);

  const handleQuickActionPress = useCallback(
    (label: string) => {
      if (label === "群聊") {
        router.push("/(tabs)/contacts/groups");
      }
    },
    [router],
  );

  const renderItem = useCallback(
    ({
      item,
      index,
      section,
    }: SectionListRenderItemInfo<Contact, ContactSection>) => (
      <View>
        <Pressable
          style={s.contactRow}
          onPress={() =>
            router.push(
              getUserProfileHref(
                "contacts",
                getUserProfileIdByName(item.name),
                item.name,
              ),
            )
          }
        >
          <Pressable
            onPress={() =>
              router.push(
                getUserProfileHref(
                  "contacts",
                  getUserProfileIdByName(item.name),
                  item.name,
                ),
              )
            }
          >
            <Avatar size={40} name={item.name} uri={item.avatarUrl} />
          </Pressable>
          <Text style={d.contactName}>{item.name}</Text>
        </Pressable>
        {index < section.data.length - 1 && <Divider />}
      </View>
    ),
    [router, d],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<Contact, ContactSection> }) => (
      <View style={s.sectionHeader}>
        <Text style={d.sectionLetter}>{section.letter}</Text>
      </View>
    ),
    [d],
  );

  const keyExtractor = useCallback((item: Contact) => item.id, []);

  const ListHeader = (
    <View style={s.headerSection}>
      <View style={s.titleRow}>
        <Text style={d.title}>联系人</Text>
        <Pressable onPress={handleAddFriend}>
          <Ionicons name="person-add-outline" size={24} color={colors.text} />
        </Pressable>
      </View>
      <SearchBar placeholder="搜索联系人..." onPress={handleOpenSearch} />
      <View style={s.quickActions}>
        {QUICK_ACTIONS.map((action, i) => (
          <View key={action.label}>
            <MenuRow
              icon={action.icon}
              iconBgColor={action.iconBg}
              label={action.label}
              onPress={() => handleQuickActionPress(action.label)}
            />
            {i < QUICK_ACTIONS.length - 1 && <Divider />}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <SectionList
        sections={CONTACT_SECTIONS}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
      />
      <View
        style={[s.alphabetIndex, { top: insets.top + 200, bottom: 100 }]}
      >
        {ALPHABET.map((letter) => (
          <Text key={letter} style={d.alphabetLetter}>
            {letter}
          </Text>
        ))}
      </View>
    </View>
  );
}
