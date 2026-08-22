import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Platform } from 'react-native';
import { getLocales } from 'expo-localization';
import { storage } from '@/storage';

import zh from './locales/zh.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import es from './locales/es.json';

const LANGUAGE_KEY = '@circle_im_language';

export const APP_LANGUAGE_OPTIONS = [
  { labelKey: 'appSettings.languageSheet.zh', value: 'zh' },
  { labelKey: 'appSettings.languageSheet.en', value: 'en' },
  { labelKey: 'appSettings.languageSheet.ja', value: 'ja' },
  { labelKey: 'appSettings.languageSheet.ko', value: 'ko' },
  { labelKey: 'appSettings.languageSheet.es', value: 'es' },
] as const;

export type AppLanguage = (typeof APP_LANGUAGE_OPTIONS)[number]['value'];
export type AppLanguagePreference = 'system' | AppLanguage;

const resources = {
  zh: { translation: zh },
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },
  es: { translation: es },
};

const i18n = i18next;

function isAppLanguage(value: unknown): value is AppLanguage {
  return (
    typeof value === 'string' &&
    APP_LANGUAGE_OPTIONS.some((option) => option.value === value)
  );
}

function getDeviceLanguage(): AppLanguage {
  const locales = getLocales();
  const lang = locales[0]?.languageCode?.toLowerCase() ?? 'zh';
  if (isAppLanguage(lang)) return lang;
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function canUseSynchronousStorage() {
  return typeof window !== 'undefined';
}

function getSavedLanguagePreference(): AppLanguagePreference {
  if (!canUseSynchronousStorage()) {
    return 'system';
  }

  const saved = storage.getString(LANGUAGE_KEY);
  if (isAppLanguage(saved)) return saved;
  return 'system';
}

function getInitialLanguage(): AppLanguage {
  if (!canUseSynchronousStorage()) {
    return getDeviceLanguage();
  }

  const saved = getSavedLanguagePreference();
  return saved === 'system' ? getDeviceLanguage() : saved;
}

// init 返回 Promise；同步部分（设置默认 lng）已经在 init 调用时完成，异步部分
// 用 void 标注以避免 unhandled-rejection 警告。
void i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  // en 是结构事实源（i18n-locale-parity 保证 en ⊇ 每个 locale 的 base key），因此所有
  // 语言最终回落到 en，而不是中文 —— 避免非中文用户在偶发缺 key 时意外看到中文。
  fallbackLng: {
    zh: ['zh', 'en'],
    default: ['en'],
  },
  interpolation: {
    escapeValue: false,
  },
});

export function setLanguage(lang: AppLanguagePreference) {
  // changeLanguage 是 async（可能加载懒包），但调用方都是 fire-and-forget 风格；
  // 用 void 显式表示我们不等待 —— 否则 lint 会标 unhandled-promise。
  if (lang === 'system') {
    if (canUseSynchronousStorage()) {
      storage.remove(LANGUAGE_KEY);
    }
    void i18n.changeLanguage(getDeviceLanguage());
    return;
  }

  void i18n.changeLanguage(lang);
  if (canUseSynchronousStorage()) {
    storage.set(LANGUAGE_KEY, lang);
  }
}

export function getCurrentLanguage(): AppLanguage {
  const language = i18n.language?.toLowerCase();
  return isAppLanguage(language) ? language : 'zh';
}

export function getCurrentLanguagePreference(): AppLanguagePreference {
  return getSavedLanguagePreference();
}

/**
 * Re-read the persisted language and apply it. Called after the
 * AsyncStorage→MMKV migration completes so users upgrading from an older
 * build don't lose their language preference for the first session.
 */
export function rehydrateLanguageFromStorage() {
  if (!canUseSynchronousStorage()) {
    return;
  }

  const saved = getSavedLanguagePreference();
  void i18n.changeLanguage(saved === 'system' ? getDeviceLanguage() : saved);
}

/**
 * 网页端把 <html lang> 跟着当前语言走。
 *
 * +html.tsx 是静态模板，SSG 出来的是同一份 HTML（写死 lang="zh"），
 * 切到英/日/韩/西语后文档仍自称中文：读屏会按中文发音规则念英文，
 * 浏览器的翻译提示和断词规则也跟着错。只能在运行时同步。
 *
 * 挂在 i18n 上而不是某个组件里：语言可以从设置页、系统语言变化、
 * 存储迁移回灌等多处改，组件里同步必然漏掉其中一条路径。
 */
if (Platform.OS === 'web') {
  const syncDocumentLang = (lng: string) => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lng;
  };
  syncDocumentLang(i18n.language);
  i18n.on('languageChanged', syncDocumentLang);
}

export default i18n;
