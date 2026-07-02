// `toLocaleString` / `toLocaleDateString` 的 BCP-47 locale 实参。集中一处，避免各页面
// 各写 `i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'` —— 新增 ja/ko/es 后那种写法会
// 让这三种语言错用 en-US 的日期/数字格式。这里覆盖 App 支持的全部界面语言。
//
// 放在 @/utils（而非某个 feature 下）：im/mappers、chat、contacts 都要用，属跨领域工具，
// 不应让 IM 层反向依赖 contacts feature。
const BCP47_BY_LANGUAGE: Record<string, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  es: 'es-ES',
};

export function getLocalizedDateTimeLocale(i18nLanguage: string): string {
  // i18n.language 可能是 'zh'、'zh-Hant'、'en-US' 等；取主语言子标签匹配。
  const base = (i18nLanguage ?? '').toLowerCase().split('-')[0];
  return BCP47_BY_LANGUAGE[base] ?? 'en-US';
}
