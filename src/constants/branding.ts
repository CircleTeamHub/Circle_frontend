export const APP_DISPLAY_NAME = '风信';
export const APP_PUBLIC_NAME = 'windnote.ai';

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
