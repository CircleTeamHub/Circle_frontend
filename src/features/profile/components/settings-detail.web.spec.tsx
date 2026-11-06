/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsSectionView } from './settings-detail';

jest.mock('react-native', () => jest.requireActual('react-native-web'));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: { primary: '#6366f1', white: '#fff', switchOffTrack: '#ddd' } }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test('clicking the web switch submits its new value exactly once', async () => {
  const onValueChange = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<SettingsSectionView section={{ rows: [{
        id: 'push', labelKey: 'push', type: 'toggle', value: false, onValueChange,
      }] }} />);
    });
    const input = container.querySelector<HTMLInputElement>('input')!;
    await act(async () => input.click());
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(input.getAttribute('aria-label')).toBe('push');
    expect(input.closest('[tabindex]')?.getAttribute('tabindex')).toBe('-1');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
