import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

type NetworkStatus = {
  isOffline: boolean;
};

let cachedOnline = true;

async function probe(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch('https://clients3.google.com/generate_204', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

export function useNetworkStatus(): NetworkStatus {
  const [isOffline, setIsOffline] = useState(!cachedOnline);

  useEffect(() => {
    let active = true;

    const check = async () => {
      const online = await probe();
      cachedOnline = online;
      if (active) {
        setIsOffline(!online);
      }
    };

    check();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        check();
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return { isOffline };
}
