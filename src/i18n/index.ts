import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import zh from './locales/zh.json';
import en from './locales/en.json';

const LANGUAGE_KEY = '@circle_im_language';

const resources = {
  zh: { translation: zh },
  en: { translation: en },
};

function getDeviceLanguage(): string {
  const locales = getLocales();
  const lang = locales[0]?.languageCode ?? 'zh';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  lng: getDeviceLanguage(),
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
  },
});

// Restore saved language preference
AsyncStorage.getItem(LANGUAGE_KEY).then((saved) => {
  if (saved && (saved === 'zh' || saved === 'en')) {
    i18n.changeLanguage(saved);
  }
});

export function setLanguage(lang: 'zh' | 'en') {
  i18n.changeLanguage(lang);
  AsyncStorage.setItem(LANGUAGE_KEY, lang);
}

export function getCurrentLanguage(): 'zh' | 'en' {
  return (i18n.language?.startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en';
}

export default i18n;
