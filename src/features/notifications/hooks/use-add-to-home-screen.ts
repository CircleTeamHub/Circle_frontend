import { useCallback, useState, useSyncExternalStore } from 'react';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  homeScreenInstallMode,
  showInstallPrompt,
  subscribeHomeScreenInstall,
} from '../services/home-screen-install';

const noMode = () => null;

/** 点「添加」：能弹浏览器安装框就直接弹（一键），iOS 上打开步骤说明。 */
export function useAddToHomeScreen() {
  const mode = useSyncExternalStore(subscribeHomeScreenInstall, homeScreenInstallMode, noMode);
  const [guideVisible, setGuideVisible] = useState(false);

  const start = useCallback(() => {
    if (homeScreenInstallMode() === 'prompt') {
      showInstallPrompt().catch(error => reportHandledFailure('homeScreenInstall', 'prompt', error));
      return;
    }
    setGuideVisible(true);
  }, []);
  const closeGuide = useCallback(() => setGuideVisible(false), []);

  return { mode, start, guideVisible, closeGuide };
}
