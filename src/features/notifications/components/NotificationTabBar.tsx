import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export type NotificationTabKey = 'interactive' | 'circle';

interface Props {
  active: NotificationTabKey;
  interactiveUnread: boolean;
  circleUnread: boolean;
  labels: { interactive: string; circle: string };
  onSelect: (key: NotificationTabKey) => void;
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', height: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4D4F' },
  underline: { position: 'absolute', bottom: 0, height: 2, left: '25%', right: '25%' },
});

export const NotificationTabBar = memo(function NotificationTabBar(p: Props) {
  const { colors } = useTheme();
  const tab = (key: NotificationTabKey, label: string, unread: boolean) => {
    const selected = p.active === key;
    return (
      <Pressable style={s.tab} onPress={() => p.onSelect(key)}>
        <View style={s.labelRow}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: selected ? colors.primary : colors.text }}>
            {label}
          </Text>
          {unread ? <View style={s.dot} /> : null}
        </View>
        {selected ? <View style={[s.underline, { backgroundColor: colors.primary }]} /> : null}
      </Pressable>
    );
  };
  return (
    <View style={[s.bar, { backgroundColor: colors.surface, borderBottomColor: colors.surfaceBorder }]}>
      {tab('interactive', p.labels.interactive, p.interactiveUnread)}
      {tab('circle', p.labels.circle, p.circleUnread)}
    </View>
  );
});
