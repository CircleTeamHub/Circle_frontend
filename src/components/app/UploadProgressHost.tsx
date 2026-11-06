import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUploadProgressStore, type UploadProgressTask } from '@/stores/upload-progress-store';
import { useTheme } from '@/theme';
import { Radius, Spacing, Typography } from '@/theme/tokens';

const VISIBLE_TASKS = 2;

/** A view overlay, including inside existing native modals; it never owns task lifetimes. */
export function UploadProgressHost() {
  const tasks = useUploadProgressStore((state) => state.tasks);
  // Chat media already shows its transfer inside the image/video bubble.
  const activeTasks = Object.values(tasks).filter(task => !task.progressKey);
  // Inactive viewers and sheets need no additional native views or context hooks.
  return activeTasks.length > 0 ? <UploadProgressCard tasks={activeTasks} /> : null;
}

function UploadProgressCard({ tasks }: { tasks: UploadProgressTask[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const remaining = tasks.length - VISIBLE_TASKS;

  return (
    <View
      testID="upload-progress-host"
      pointerEvents="none"
      style={[
        s.host,
        {
          top: insets.top + 64,
          left: insets.left + Spacing.md,
          right: insets.right + Spacing.md,
        },
      ]}
    >
      <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder }]}>
        <Text style={[s.title, { color: colors.text }]}>{t('mediaUpload.uploading')}</Text>
        {tasks.slice(0, VISIBLE_TASKS).map((task) => {
          const percent = task.total === null ? null : Math.floor(task.loaded / task.total * 100);
          const confirming = percent === 100;
          const status = confirming
            ? t('mediaUpload.confirming')
            : percent !== null
              ? `${percent}%`
              : t(task.loaded === 0 ? 'mediaUpload.preparing' : 'mediaUpload.uploading');

          return (
            <View
              key={task.id}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t(`mediaUpload.${task.kind}`)}
              accessibilityValue={percent === null ? { text: status } : { min: 0, max: 100, now: percent, text: status }}
              style={s.task}
            >
              <View style={s.taskHeader}>
                <Text style={[s.kind, { color: colors.textSecondary }]}>{t(`mediaUpload.${task.kind}`)}</Text>
                <View style={s.status}>
                  {percent === null || confirming ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                  <Text style={[s.statusText, { color: colors.textSecondary }]}>{status}</Text>
                </View>
              </View>
              {percent !== null ? (
                <View style={[s.track, { backgroundColor: colors.surfaceBorder }]}>
                  <View style={[s.fill, { backgroundColor: colors.primary, width: `${percent}%` }]} />
                </View>
              ) : null}
            </View>
          );
        })}
        {remaining > 0 ? (
          <Text style={[s.additional, { color: colors.textSecondary }]}>{t('mediaUpload.additional', { count: remaining })}</Text>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  host: { position: 'absolute', zIndex: 1000, alignItems: 'flex-end' },
  card: {
    width: '100%',
    maxWidth: 320,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { ...Typography.caption, fontWeight: '600' },
  task: { gap: Spacing.xs },
  taskHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  kind: { ...Typography.small, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  statusText: { ...Typography.small, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  additional: { ...Typography.small },
});
