import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FloatingModal } from '@/components/ui/floating-modal';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface ClearHistoryDialogProps {
  visible: boolean;
  onCancel: () => void;
  /** bothSides=true:清完自己的,再向对方申请双向清空。 */
  onConfirm: (bothSides: boolean) => void;
}

const s = StyleSheet.create({
  card: { padding: Spacing.lg, gap: Spacing.md },
  title: { ...Typography.h3, textAlign: 'center' },
  hint: { ...Typography.small, textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, minHeight: 40 },
  checkLabel: { ...Typography.body },
  actions: { flexDirection: 'row', gap: Spacing.md },
  button: { flex: 1, height: 44, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...Typography.body, fontWeight: '600' },
});

/** 私聊清空聊天记录:默认只清自己的;勾「双向清空」会请对方授权清对方那份。 */
export function ClearHistoryDialog({ visible, onCancel, onConfirm }: ClearHistoryDialogProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [bothSides, setBothSides] = useState(false);

  useEffect(() => {
    if (visible) setBothSides(false);
  }, [visible]);

  return (
    <FloatingModal visible={visible} onClose={onCancel} backdropStyle={{ backgroundColor: colors.overlay }}>
      <View style={[s.card, { backgroundColor: colors.surface }]}>
        <Text style={[s.title, { color: colors.text }]}>
          {t('chat.clearHistoryConfirmTitle', { defaultValue: '确定要清空聊天记录？' })}
        </Text>
        <Text style={[s.hint, { color: colors.error }]}>
          {t('chat.clearHistoryBothSidesHint', {
            defaultValue: '申请双向清空需好友「确定授权」才会清空对方的消息记录',
          })}
        </Text>
        <Pressable
          style={s.checkRow}
          onPress={() => setBothSides((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: bothSides }}
        >
          <Ionicons
            name={bothSides ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={bothSides ? colors.primary : colors.textSecondary}
          />
          <Text style={[s.checkLabel, { color: colors.text }]}>
            {t('chat.clearHistoryBothSides', { defaultValue: '双向清空' })}
          </Text>
        </Pressable>
        <View style={s.actions}>
          <Pressable style={[s.button, { backgroundColor: colors.inputBg }]} onPress={onCancel} accessibilityRole="button">
            <Text style={[s.buttonText, { color: colors.text }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            style={[s.button, { backgroundColor: colors.error }]}
            onPress={() => onConfirm(bothSides)}
            accessibilityRole="button"
          >
            <Text style={[s.buttonText, { color: colors.white }]}>{t('common.confirm')}</Text>
          </Pressable>
        </View>
      </View>
    </FloatingModal>
  );
}
