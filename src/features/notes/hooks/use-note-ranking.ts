import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchNoteRanking } from '@/services/api/notes';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import type { NoteRanking } from '@/features/notes/types';

/**
 * 大众点评月榜的数据。城市一变就重拉；晚到的旧城市结果直接丢掉，免得筛选是
 * 成都、列表却是上一次的上海。刷新时保留旧榜单，失败只提示不清空。
 */
export function useNoteRanking(city: string | null) {
  const { t } = useTranslation();
  const [ranking, setRanking] = useState<NoteRanking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchNoteRanking(city);
      if (request !== requestRef.current) return;
      setRanking(next);
    } catch (err) {
      if (request !== requestRef.current) return;
      reportHandledFailure('noteRanking', 'load', err);
      setError(getApiErrorMessage(err, t('explore.ranking.loadFailed', { defaultValue: '榜单加载失败' })));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [city, t]);

  useEffect(() => {
    // 换城市先清掉上一个城市的榜单，空白 + 转圈比短暂显示错城市的数据更诚实。
    setRanking(null);
    void load();
  }, [load]);

  return { ranking, loading, error, reload: load };
}
