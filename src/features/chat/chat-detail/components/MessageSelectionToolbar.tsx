import type { MessageSelectionProgress } from '../hooks/use-message-actions';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, withAlpha } from '@/theme';

export type MessageSelectionToolbarProps = {
  count: number;
  bottomInset: number;
  canSave: boolean;
  canForward: boolean;
  canCollect: boolean;
  progress: MessageSelectionProgress | null;
  onSave: () => void;
  onForward: () => void;
  onCollect: () => void;
  onDelete: () => void;
  onCancel: () => void;
};

export function MessageSelectionToolbar({
  count, bottomInset, canSave, canForward, canCollect, progress,
  onSave, onForward, onCollect, onDelete, onCancel,
}: MessageSelectionToolbarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const busy = progress !== null;
  const actions: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; tint: string; enabled: boolean; onPress: () => void }[] = [
    { key: 'save', icon: 'download-outline', label: t('common.save'), tint: colors.blue, enabled: canSave, onPress: onSave },
    { key: 'forward', icon: 'arrow-redo-outline', label: t('chat.messageActions.forward'), tint: colors.iconAccent, enabled: canForward, onPress: onForward },
    { key: 'collect', icon: 'star-outline', label: t('chat.messageActions.collect'), tint: colors.warningText, enabled: canCollect, onPress: onCollect },
    { key: 'delete', icon: 'trash-outline', label: t('common.delete'), tint: colors.danger, enabled: count > 0, onPress: onDelete },
  ];
  return (
    <View style={[s.dock, { backgroundColor: colors.background, paddingBottom: Math.max(bottomInset, 10) }]}>
      <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
        <View style={s.header}>
          <View style={s.selectionStatus} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={18} color={colors.iconAccent} />
            <Text style={[s.count, { color: colors.text }]}>
              {progress
                ? t(progress.action === 'save' ? 'chat.selection.saving' : 'chat.selection.collecting', {
                    current: progress.current, total: progress.total,
                    defaultValue: progress.action === 'save' ? '正在保存 {{current}}/{{total}}' : '正在收藏 {{current}}/{{total}}',
                  })
                : t('chat.selection.selectedCount', { count, defaultValue: '已选 {{count}} 条消息' })}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')}
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={onCancel}
            style={({ pressed }) => [s.cancel, { opacity: busy ? 0.4 : 1, backgroundColor: pressed ? colors.background : 'transparent' }]}>
            <Text style={[s.cancelLabel, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
        {count > 0 && !canSave && !busy ? (
          <Text style={[s.hint, { color: colors.textSecondary }]}>
            {t('chat.selection.saveHint', { defaultValue: '保存仅支持普通图片和视频' })}
          </Text>
        ) : null}
        <View style={s.actions}>
          {actions.map((action) => {
            const disabled = busy || count === 0 || !action.enabled;
            return (
              <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label}
                accessibilityState={{ disabled, busy: progress?.action === action.key }}
                disabled={disabled} onPress={action.onPress}
                style={({ pressed }) => [s.action, { opacity: disabled && progress?.action !== action.key ? 0.38 : 1,
                  backgroundColor: pressed ? colors.background : 'transparent' }]}>
                {action.key === 'delete' ? <View style={[s.separator, { backgroundColor: colors.surfaceBorder }]} /> : null}
                <View style={[s.icon, { backgroundColor: withAlpha(action.tint, 0.1) }]}>
                  {progress?.action === action.key
                    ? <ActivityIndicator size="small" color={action.tint} />
                    : <Ionicons name={action.icon} size={23} color={action.tint} />}
                </View>
                <Text style={[s.label, { color: action.key === 'delete' ? action.tint : colors.text }]}>{action.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  dock: { paddingHorizontal: 12, paddingTop: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, paddingHorizontal: 6, paddingBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 10, paddingRight: 4 },
  selectionStatus: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, paddingVertical: 10 },
  count: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  cancel: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 8, borderRadius: 14 },
  cancelLabel: { fontSize: 13, fontWeight: '500' },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 2 },
  action: { flex: 1, minWidth: 0, minHeight: 68, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 16, paddingHorizontal: 2 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  separator: { position: 'absolute', width: StyleSheet.hairlineWidth, left: 0, top: 8, bottom: 8 },
  hint: { fontSize: 12, paddingHorizontal: 10, paddingBottom: 8 },
});
