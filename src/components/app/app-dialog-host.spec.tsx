import { Alert, Modal, Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppDialogHost } from './app-dialog-host';
import { showDialog, useAppDialogStore } from './app-dialog-store';
import { installAlertBridge } from '@/utils/alert-bridge';

// 玻璃材质的两个原生模块 jest 里没有：退化成普通 View，只验证结构与行为。
jest.mock('expo-blur', () => {
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BlurView: () => null, BlurTargetView: RNView };
});
jest.mock('expo-glass-effect', () => {
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    GlassView: RNView,
    isGlassEffectAPIAvailable: () => false,
    isLiquidGlassAvailable: () => false,
  };
});

// @/theme → @/storage 会碰 MMKV / AsyncStorage 原生模块，jest 里没有。
jest.mock('@/storage', () => ({
  storage: { getString: jest.fn(), set: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  },
}));

// jest-expo 默认按 iOS 跑：iOS 走 FullWindowOverlay（原生视图），这里退化成透传。
jest.mock('react-native-screens', () => ({
  FullWindowOverlay: ({ children }: { children: React.ReactNode }) => children,
}));

// 关掉动画：每一步都同步落地，断言不用等计时器。
jest.mock('@/hooks/use-reduce-motion', () => ({
  useReduceMotion: () => true,
}));

beforeEach(() => {
  useAppDialogStore.getState().reset();
});

describe('AppDialogHost', () => {
  it('renders the queued dialog and runs the pressed button, then shows the next one', () => {
    const leave = jest.fn();
    render(<AppDialogHost />);

    act(() => {
      showDialog({
        title: '退出群聊',
        message: '退出后将不再接收该群消息',
        buttons: [
          { text: '取消', style: 'cancel' },
          { text: '退出', style: 'destructive', onPress: leave },
        ],
      });
      showDialog({ title: '第二条', buttons: [{ text: '知道了' }] });
    });

    expect(screen.getByText('退出群聊')).toBeTruthy();
    expect(screen.getByText('退出后将不再接收该群消息')).toBeTruthy();
    expect(screen.queryByText('第二条')).toBeNull();

    fireEvent.press(screen.getByText('退出'));

    expect(leave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('退出群聊')).toBeNull();
    expect(screen.getByText('第二条')).toBeTruthy();
    expect(useAppDialogStore.getState().queue).toHaveLength(1);
  });

  it('falls back to a localized OK button when no buttons are given', () => {
    render(<AppDialogHost />);
    act(() => {
      showDialog({ title: '已保存' });
    });

    fireEvent.press(screen.getByText('知道了'));
    expect(useAppDialogStore.getState().queue).toHaveLength(0);
  });

  it('closing from the scrim presses the implied cancel button and fires onDismiss', () => {
    const cancel = jest.fn();
    const onDismiss = jest.fn();
    render(<AppDialogHost />);
    act(() => {
      showDialog({
        title: '删除',
        buttons: [
          { text: '取消', style: 'cancel', onPress: cancel },
          { text: '删除', style: 'destructive' },
        ],
        onDismiss,
      });
    });

    fireEvent.press(screen.getByTestId('app-dialog-scrim'));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('删除')).toBeNull();
  });

  it('keeps a single-button dialog on screen when the scrim is tapped', () => {
    render(<AppDialogHost />);
    act(() => {
      showDialog({ title: '提示', buttons: [{ text: '知道了' }] });
    });

    fireEvent.press(screen.getByTestId('app-dialog-scrim'));

    expect(screen.getByText('提示')).toBeTruthy();
  });

  it('hands the typed text to the confirm button of a prompt dialog', () => {
    const save = jest.fn();
    render(<AppDialogHost />);
    act(() => {
      showDialog({
        title: '群名',
        prompt: { defaultValue: '老群名' },
        buttons: [
          { text: '取消', style: 'cancel' },
          { text: '保存', onPress: save },
        ],
      });
    });

    const input = screen.getByDisplayValue('老群名');
    fireEvent.changeText(input, '新群名');
    fireEvent.press(screen.getByText('保存'));

    expect(save).toHaveBeenCalledWith('新群名');
  });

  it('submitting from the keyboard presses the primary action', () => {
    const save = jest.fn();
    render(<AppDialogHost />);
    act(() => {
      showDialog({
        title: '备注',
        prompt: {},
        buttons: [
          { text: '取消', style: 'cancel' },
          { text: '保存', onPress: save },
        ],
      });
    });

    const input = screen.getByLabelText('备注');
    fireEvent.changeText(input, 'hello');
    fireEvent(input, 'submitEditing');

    expect(save).toHaveBeenCalledWith('hello');
  });

  it('routes the hardware back button through the Modal on Android', () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const cancel = jest.fn();
    try {
      render(<AppDialogHost />);
      act(() => {
        showDialog({
          title: '退出',
          buttons: [{ text: '取消', style: 'cancel', onPress: cancel }, { text: '退出' }],
        });
      });

      const modal = screen.UNSAFE_getByType(Modal);
      expect(modal.props.statusBarTranslucent).toBe(true);
      act(() => {
        modal.props.onRequestClose();
      });

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('退出')).toBeNull();
    } finally {
      platform.restore();
    }
  });
});

describe('alert bridge', () => {
  it('routes Alert.alert into the dialog queue with normalized buttons', () => {
    installAlertBridge();
    const onPress = jest.fn();
    const onDismiss = jest.fn();

    Alert.alert('标题', '正文', [{ text: '好', onPress }], {
      cancelable: true,
      onDismiss,
    });

    const [dialog] = useAppDialogStore.getState().queue;
    expect(dialog).toMatchObject({
      title: '标题',
      message: '正文',
      cancelable: true,
      onDismiss,
      buttons: [{ text: '好', onPress }],
    });
    expect(dialog.prompt).toBeUndefined();
  });

  it('routes Alert.prompt with a plain callback into a cancel/confirm prompt dialog', () => {
    installAlertBridge();
    const callback = jest.fn();

    Alert.prompt('重命名', undefined, callback, 'plain-text', '旧名字');

    const [dialog] = useAppDialogStore.getState().queue;
    expect(dialog.title).toBe('重命名');
    expect(dialog.prompt).toEqual({
      defaultValue: '旧名字',
      secureTextEntry: false,
      keyboardType: undefined,
    });
    expect(dialog.buttons?.map((button) => button.style)).toEqual(['cancel', undefined]);
    dialog.buttons?.[1].onPress?.('新名字');
    expect(callback).toHaveBeenCalledWith('新名字');
  });

  it('treats Alert.prompt type=default as a plain dialog without an input', () => {
    installAlertBridge();
    Alert.prompt('提示', '正文', [{ text: '知道了' }], 'default');
    expect(useAppDialogStore.getState().queue[0].prompt).toBeUndefined();
  });
});
