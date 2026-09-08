import { create } from 'zustand';
import type { DialogButton } from './app-dialog-buttons';

/**
 * 全 App 弹窗队列（zustand，纯 TS，可在 node 里直接测）。
 *
 * `Alert.alert` / `Alert.prompt` 经 utils/alert-bridge 全部改投到这里，
 * AppDialogHost 挂在根布局逐个渲染。队列而不是"后弹的叠上面"：
 * 一次只让用户面对一个决定，也避免两层蒙层叠出黑块。
 *
 * 宿主未挂载（启动极早期、AuthRouteGuard 的 loading 态）时调用不会丢 ——
 * 请求留在 store 里，宿主挂上来就放出。
 */

export interface DialogPromptConfig {
  defaultValue?: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?:
    | 'default'
    | 'email-address'
    | 'numeric'
    | 'phone-pad'
    | 'number-pad'
    | 'decimal-pad'
    | 'url';
}

export interface DialogRequest {
  title: string;
  message?: string;
  /** 为空时宿主补一个本地化的「知道了」。 */
  buttons?: readonly DialogButton[];
  /**
   * 点蒙层 / 系统返回 / Esc 能否关掉。
   * 未指定时：有 cancel 按钮 → 关掉并按下那个 cancel；否则锁死（只能点按钮）。
   * 显式 true 时关掉只触发 onDismiss，不按任何按钮（原生 Alert 语义）。
   */
  cancelable?: boolean;
  onDismiss?: () => void;
  /** 带输入框的弹窗（对应 Alert.prompt）。 */
  prompt?: DialogPromptConfig;
}

export interface QueuedDialog extends DialogRequest {
  id: number;
}

export interface DialogDismissal {
  allowed: boolean;
  /** 关掉时要顺带按下的 cancel 按钮（只在「由 cancel 按钮隐含可关」时存在）。 */
  cancelButton?: DialogButton;
}

interface AppDialogState {
  queue: QueuedDialog[];
  enqueue: (request: DialogRequest) => number;
  remove: (id: number) => void;
  reset: () => void;
}

let nextId = 1;

function isSameDialog(a: DialogRequest, b: DialogRequest): boolean {
  if (a.prompt || b.prompt) return false;
  if (a.title !== b.title || a.message !== b.message) return false;
  const aTexts = (a.buttons ?? []).map((button) => button.text);
  const bTexts = (b.buttons ?? []).map((button) => button.text);
  return aTexts.length === bTexts.length && aTexts.every((t, i) => t === bTexts[i]);
}

export const useAppDialogStore = create<AppDialogState>((set, get) => ({
  queue: [],
  enqueue: (request) => {
    const { queue } = get();
    // 双击 / 双触发会把同一个确认框排两遍，用户关掉一个又冒一个。
    // 还没关掉的同文案弹窗视作同一次请求。
    const existing = queue.find((queued) => isSameDialog(queued, request));
    if (existing) return existing.id;

    const id = nextId++;
    set({ queue: [...queue, { ...request, id }] });
    return id;
  },
  remove: (id) => {
    set({ queue: get().queue.filter((dialog) => dialog.id !== id) });
  },
  reset: () => set({ queue: [] }),
}));

export function showDialog(request: DialogRequest): number {
  return useAppDialogStore.getState().enqueue(request);
}

export function dismissDialog(id: number): void {
  useAppDialogStore.getState().remove(id);
}

export function resolveDialogDismissal(dialog: QueuedDialog): DialogDismissal {
  if (dialog.cancelable === true) return { allowed: true };
  if (dialog.cancelable === false) return { allowed: false };
  const cancelButton = dialog.buttons?.find((button) => button.style === 'cancel');
  return cancelButton ? { allowed: true, cancelButton } : { allowed: false };
}
