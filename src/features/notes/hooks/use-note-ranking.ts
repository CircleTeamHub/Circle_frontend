import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchNoteRanking } from '@/services/api/notes';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import type { NoteRanking, NoteRankingBoard } from '@/features/notes/types';

/**
 * 大众点评月榜的数据。城市或榜单（好评榜 / 差评榜）一变就重拉；晚到的旧结果直接丢掉，
 * 免得筛选是成都、列表却是上一次的上海，或者差评榜下面挂着好评榜的笔记。
 * 刷新时保留旧榜单，失败只提示不清空。
 */
export function useNoteRanking(city: string | null, board: NoteRankingBoard) {
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
      const next = await fetchNoteRanking(city, board);
      if (request !== requestRef.current) return;
      setRanking(next);
    } catch (err) {
      if (request !== requestRef.current) return;
      reportHandledFailure('noteRanking', 'load', err);
      setError(getApiErrorMessage(err, t('explore.ranking.loadFailed', { defaultValue: '榜单加载失败' })));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [board, city, t]);

  useEffect(() => {
    // 换城市、换榜单先清掉上一份，空白 + 转圈比短暂显示错的数据更诚实。
    setRanking(null);
    void load();
  }, [load]);

  return { ranking, loading, error, reload: load };
}
