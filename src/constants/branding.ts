export const APP_DISPLAY_NAME = '风信';
export const APP_PUBLIC_NAME = 'windnote.ai';

/** 浏览器标签页标题（桌面网页版）：英文字标 + 中文名。与 app.json 的
 *  expo.web.name 保持一致 —— 那边管冷加载的静态 <title>，这边管运行时。 */
export const APP_WEB_TITLE = 'WindNote 风信';

export const APP_DEEP_LINK_SCHEMES = ['windnoteai', 'circleim'] as const;

export const APP_LINK_PROTOCOLS = APP_DEEP_LINK_SCHEMES.map(
  (scheme) => `${scheme}:`,
);

export const APP_UNIVERSAL_LINK_HOSTS = [
  'windnote.ai',
  'www.windnote.ai',
  'circle.im',
  'www.circle.im',
] as const;
