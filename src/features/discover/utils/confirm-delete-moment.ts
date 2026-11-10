import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { useMomentsStore } from '@/features/discover/store/use-moments-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { deleteMoment } from '@/services/api/moments';
import { useAuthStore } from '@/stores/authStore';
import type { MomentPost } from '@/types';

const pendingDeletes = new Set<string>();

export function confirmDeleteMoment(post: MomentPost, t: TFunction, onDeleted?: () => void): void {
  const { id, author } = post;
  const { user, sessionEpoch } = useAuthStore.getState();
  if (user?.id !== author.id || pendingDeletes.has(id)) return;

  const isCurrentSession = () => useAuthStore.getState().sessionEpoch === sessionEpoch;
  Alert.alert(t('moment.deleteTitle'), t('moment.deleteMessage'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('common.delete'),
      style: 'destructive',
      onPress: async () => {
        if (!isCurrentSession() || pendingDeletes.has(id)) return;
        pendingDeletes.add(id);
        try {
          await deleteMoment(id);
        } catch (error) {
          if (isCurrentSession()) {
            reportHandledFailure('moments', 'delete', error);
            Alert.alert(
              t('moment.deleteFailedTitle'),
              getApiErrorMessage(error, t('moment.deleteFailedMessage')),
            );
          }
          return;
        } finally {
          pendingDeletes.delete(id);
        }
        if (isCurrentSession()) {
          useMomentsStore.getState().removeMoment(id);
          onDeleted?.();
        }
      },
    },
  ]);
}
