import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { storage } from '@/storage';

import zh from './locales/zh.json';
import en from './locales/en.json';

const LANGUAGE_KEY = '@circle_im_language';

const resources = {
  zh: { translation: zh },
  en: { translation: en },
};

function getDeviceLanguage(): 'zh' | 'en' {
  const locales = getLocales();
  const lang = locales[0]?.languageCode ?? 'zh';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function canUseSynchronousStorage() {
  return typeof window !== 'undefined';
}

function getInitialLanguage(): 'zh' | 'en' {
  if (!canUseSynchronousStorage()) {
    return getDeviceLanguage();
  }

  const saved = storage.getString(LANGUAGE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return getDeviceLanguage();
}

// init 返回 Promise；同步部分（设置默认 lng）已经在 init 调用时完成，异步部分
// 用 void 标注以避免 unhandled-rejection 警告。
void i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
  },
});

export function setLanguage(lang: 'zh' | 'en') {
  // changeLanguage 是 async（可能加载懒包），但调用方都是 fire-and-forget 风格；
  // 用 void 显式表示我们不等待 —— 否则 lint 会标 unhandled-promise。
  void i18n.changeLanguage(lang);
  if (canUseSynchronousStorage()) {
    storage.set(LANGUAGE_KEY, lang);
  }
}

export function getCurrentLanguage(): 'zh' | 'en' {
  return (i18n.language?.startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en';
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

  const saved = storage.getString(LANGUAGE_KEY);
  if (saved === 'zh' || saved === 'en') {
    void i18n.changeLanguage(saved);
  }
}

export default i18n;
