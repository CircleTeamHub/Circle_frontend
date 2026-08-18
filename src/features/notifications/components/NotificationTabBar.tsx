import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

/**
 * `notifications` = 当前域的通知列表（互动 / 朋友圈 / 圈子，取决于入口）；
 * `signups` = 报名管理（我发的圈子帖收到的报名），只在圈子铃铛和无域兜底页出现。
 */
export type NotificationTabKey = 'notifications' | 'signups';

export interface NotificationTabItem {
  key: NotificationTabKey;
  label: string;
  unread: boolean;
}

interface Props {
  active: NotificationTabKey;
  tabs: NotificationTabItem[];
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
  // 单 tab 时（朋友圈铃铛）没有可切换的东西，整条 bar 不渲染。
  if (p.tabs.length < 2) return null;
  return (
    <View style={[s.bar, { backgroundColor: colors.surface, borderBottomColor: colors.surfaceBorder }]}>
      {p.tabs.map((item) => {
        const selected = p.active === item.key;
        return (
          <Pressable key={item.key} style={s.tab} onPress={() => p.onSelect(item.key)}>
            <View style={s.labelRow}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: selected ? colors.primary : colors.text }}>
                {item.label}
              </Text>
              {item.unread ? <View style={s.dot} /> : null}
            </View>
            {selected ? <View style={[s.underline, { backgroundColor: colors.primary }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
});
