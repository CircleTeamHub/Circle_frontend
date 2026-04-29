import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchNoteGroups, fetchNotes } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import {
  FORCE_SYNC_COOLDOWN_MS,
  useNotesSettingsStore,
} from '@/features/notes/store/use-notes-settings-store';

interface SwitchRowProps {
  label: string;
  value: boolean;
  onToggle: (next: boolean) => void;
}

function SwitchRow({ label, value, onToggle }: SwitchRowProps) {
  const { colors } = useTheme();
  return (
    <View style={s.switchRow}>
      <Text style={[s.switchLabel, { color: colors.text }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.surfaceBorder, true: colors.primary }}
        thumbColor={colors.white}
      />
    </View>
  );
}

export default function NotesSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const confirmCardSave = useNotesSettingsStore((st) => st.confirmCardSave);
  const defaultSaveCard = useNotesSettingsStore((st) => st.defaultSaveCard);
  const showMedia = useNotesSettingsStore((st) => st.showMedia);
  const showGroups = useNotesSettingsStore((st) => st.showGroups);
  const showUngrouped = useNotesSettingsStore((st) => st.showUngrouped);
  const showSortToolbar = useNotesSettingsStore((st) => st.showSortToolbar);
  const lastForceSyncAt = useNotesSettingsStore((st) => st.lastForceSyncAt);
  const setConfirmCardSave = useNotesSettingsStore(
    (st) => st.setConfirmCardSave,
  );
  const setDefaultSaveCard = useNotesSettingsStore(
    (st) => st.setDefaultSaveCard,
  );
  const setShowMedia = useNotesSettingsStore((st) => st.setShowMedia);
  const setShowGroups = useNotesSettingsStore((st) => st.setShowGroups);
  const setShowUngrouped = useNotesSettingsStore((st) => st.setShowUngrouped);
  const setShowSortToolbar = useNotesSettingsStore(
    (st) => st.setShowSortToolbar,
  );
  const markForceSync = useNotesSettingsStore((st) => st.markForceSync);

  const [syncing, setSyncing] = useState(false);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile/notes');
    }
  }, [router]);

  const handleForceSync = useCallback(async () => {
    if (syncing) return;
    const elapsed = Date.now() - lastForceSyncAt;
    if (elapsed < FORCE_SYNC_COOLDOWN_MS) {
      const remain = Math.ceil((FORCE_SYNC_COOLDOWN_MS - elapsed) / 1000);
      Alert.alert('冷却中', `请在 ${remain} 秒后再试。`);
      return;
    }

    Alert.alert(
      '清理本地并强制同步',
      '将清空本地笔记与上传队列，再从服务器全量拉取。继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '继续',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSyncing(true);
              try {
                const [notes, groups] = await Promise.all([
                  fetchNotes(),
                  fetchNoteGroups(),
                ]);
                markForceSync();
                Alert.alert(
                  '同步完成',
                  `总变更条数（含已删除条数）：${notes.length + groups.length}\n当前可见笔记条数：${notes.length}`,
                );
              } catch {
                Alert.alert('同步失败', '请稍后再试。');
              } finally {
                setSyncing(false);
              }
            })();
          },
        },
      ],
    );
  }, [lastForceSyncAt, markForceSync, syncing]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      sectionLabel: { color: colors.textSecondary },
      divider: { backgroundColor: colors.divider },
      heading: { color: colors.text },
      hintText: { color: colors.textSecondary },
      destructiveBorder: { borderColor: colors.error },
      destructiveText: { color: colors.error },
      primaryBg: { backgroundColor: colors.primary },
      primaryText: { color: colors.white },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container]}>
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Text style={[s.headerTitle, d.heading]}>笔记设置</Text>
        <Pressable hitSlop={8} onPress={handleClose}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.sectionLabel, d.sectionLabel]}>名片保存</Text>
        <SwitchRow
          label="名片保存确认"
          value={confirmCardSave}
          onToggle={setConfirmCardSave}
        />
        <SwitchRow
          label="默认保存名片"
          value={defaultSaveCard}
          onToggle={setDefaultSaveCard}
        />

        <View style={[s.divider, d.divider]} />

        <Text style={[s.sectionLabel, d.sectionLabel]}>页面显示</Text>
        <SwitchRow
          label="显示包含媒体"
          value={showMedia}
          onToggle={setShowMedia}
        />
        <SwitchRow
          label="显示分组信息"
          value={showGroups}
          onToggle={setShowGroups}
        />
        <SwitchRow
          label="显示未分组"
          value={showUngrouped}
          onToggle={setShowUngrouped}
        />
        <SwitchRow
          label="显示排序工具栏"
          value={showSortToolbar}
          onToggle={setShowSortToolbar}
        />

        <View style={[s.divider, d.divider]} />

        <Text style={[s.heading, d.heading, s.repairTitle]}>
          异常修复：清理本地并强制同步
        </Text>
        <Text style={[s.hintText, d.hintText]}>
          当本地笔记长期卡在“上传中”时可使用。
        </Text>
        <Text style={[s.hintText, d.hintText]}>
          执行后会清理本地笔记与上传队列，再从服务器全量拉取！
        </Text>
        <Text style={[s.hintText, d.hintText]}>
          为避免频繁触发，操作后会进入冷却期。
        </Text>
        <Text style={[s.hintText, d.hintText]}>
          结果说明：同步完成会展示“总变更条数（含已删除条数）”与“当前可见笔记条数”
        </Text>

        <Pressable
          style={[s.destructiveBtn, d.destructiveBorder]}
          onPress={handleForceSync}
          disabled={syncing}
        >
          <Text style={[s.destructiveText, d.destructiveText]}>
            {syncing ? '同步中...' : '清理本地并强制同步'}
          </Text>
        </Pressable>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable style={[s.primaryBtn, d.primaryBg]} onPress={handleClose}>
          <Text style={[s.primaryBtnText, d.primaryText]}>保存</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: { ...Typography.h2, fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
  },
  sectionLabel: {
    ...Typography.small,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  switchLabel: { ...Typography.bodyRegular, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, marginTop: Spacing.md },
  heading: { ...Typography.bodyRegular, fontWeight: '700' },
  repairTitle: { marginTop: Spacing.lg, marginBottom: Spacing.sm },
  hintText: { ...Typography.small, lineHeight: 20 },
  destructiveBtn: {
    marginTop: Spacing.lg,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveText: { ...Typography.bodyRegular, fontWeight: '600' },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  primaryBtn: {
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...Typography.body, fontWeight: '600' },
});
