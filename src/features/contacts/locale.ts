// `toLocaleString` 的 BCP-47 locale 实参 —— 之前 FriendActivityDetail / NewFriends 各写了一份
// `i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'` 三元。本仓库目前仅支持 zh / en。
export function getLocalizedDateTimeLocale(i18nLanguage: string): string {
  return i18nLanguage.startsWith('zh') ? 'zh-CN' : 'en-US';
}
