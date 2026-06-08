import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, useTheme } from '@/theme';

export type ReadFilter = 'all' | 'unread';

interface Props {
  filter: ReadFilter;
  labels: { all: string; unread: string; markAll: string };
  onSelect: (f: ReadFilter) => void;
  onMarkAll: () => Promise<void>;
}

const s = StyleSheet.create({
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  chip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: Radius.sm, borderWidth: 1 },
  spacer: { flex: 1 },
});

export const ReadFilterBar = memo(function ReadFilterBar(p: Props) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const chip = (key: ReadFilter, label: string) => {
    const on = p.filter === key;
    return (
      <Pressable
        style={[s.chip, { backgroundColor: on ? colors.primaryLight : colors.surface, borderColor: on ? colors.primary : colors.surfaceBorder }]}
        onPress={() => p.onSelect(key)}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: on ? colors.primary : colors.textSecondary }}>{label}</Text>
      </Pressable>
    );
  };
  const handleMarkAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await p.onMarkAll();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[s.bar, { backgroundColor: colors.background, borderBottomColor: colors.surfaceBorder }]}>
      {chip('all', p.labels.all)}
      {chip('unread', p.labels.unread)}
      <View style={s.spacer} />
      <Pressable onPress={handleMarkAll} disabled={busy} hitSlop={8}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>{p.labels.markAll}</Text>
        )}
      </Pressable>
    </View>
  );
});
