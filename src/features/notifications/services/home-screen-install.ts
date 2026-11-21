import { Platform } from 'react-native';

/**
 * 「添加到主屏幕」。Chrome / Edge 会发 beforeinstallprompt，把它留着，用户点「添加」时
 * 就能直接弹浏览器自己的安装框；iOS 的 Safari 没有任何可调用的安装接口，只能把分享菜单
 * 里的步骤讲给用户（见 AddToHomeScreenGuide）。
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type HomeScreenInstallMode = 'prompt' | 'guide' | null;

let deferredPrompt: InstallPromptEvent | null = null;
let installed = false;
let listening = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

export function isStandaloneDisplay(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isAppleMobileBrowser(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * 微信、QQ 等 App 内置的网页在 iOS 上没有「添加到主屏幕」。它们的 UA 里没有 `Safari/`
 * 这一段；iOS 版的 Chrome、Edge 有，而且它们的分享菜单里能添加。
 */
export function isAppleInAppBrowser(): boolean {
  return isAppleMobileBrowser() && !/Safari\//.test(navigator.userAgent);
}

/** 启动时调一次（app/_layout）：这个事件在页面加载后很快就发，等进了页面再听就错过了。 */
export function listenForInstallPrompt(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('beforeinstallprompt', event => {
    // 不让 Chrome 自己弹迷你安装条，统一由消息页的横幅来问。
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

export function homeScreenInstallMode(): HomeScreenInstallMode {
  if (Platform.OS !== 'web' || installed || isStandaloneDisplay()) return null;
  if (deferredPrompt) return 'prompt';
  return isAppleMobileBrowser() ? 'guide' : null;
}

export function subscribeHomeScreenInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 必须在点击回调里同步调用：prompt() 要用户手势，前面不能有 await。 */
export async function showInstallPrompt(): Promise<void> {
  const event = deferredPrompt;
  if (!event) return;
  // 同一个事件只能 prompt 一次；用户取消后浏览器下次加载页面会再发。
  deferredPrompt = null;
  const shown = event.prompt();
  notify();
  await shown;
  await event.userChoice;
}
