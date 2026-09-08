import type { Ionicons } from '@expo/vector-icons';
import type { ProfileContact } from '@/features/user/data/profiles';
import type { ThemeColors } from '@/theme';

export type ProfileContactFieldId = keyof ProfileContact;

type ProfileContactField = {
  id: ProfileContactFieldId;
  /** i18n key，不在这里 t() —— 文案解析留给渲染层，这个模块保持纯函数、可单测。 */
  labelKey: `profileFields.${ProfileContactFieldId}`;
  icon: keyof typeof Ionicons.glyphMap;
  /** 图标块底色，取 theme token 而不是写死色值。 */
  color: keyof ThemeColors;
};

/**
 * 展示顺序与隐私设置页的开关顺序保持一致（手机号 → 邮箱 → 微信号 → QQ号），
 * 这样用户拨完开关回到资料页，看到的是同一个次序。
 *
 * 配色：微信绿 / QQ 蓝沿用品牌直觉，手机号与邮箱各取一色，四行不撞色。
 */
export const PROFILE_CONTACT_FIELDS: readonly ProfileContactField[] = [
  {
    id: 'phone',
    labelKey: 'profileFields.phone',
    icon: 'call',
    color: 'deepPurple',
  },
  {
    id: 'email',
    labelKey: 'profileFields.email',
    icon: 'mail',
    color: 'orange',
  },
  {
    id: 'wechat',
    labelKey: 'profileFields.wechat',
    icon: 'chatbubbles',
    color: 'success',
  },
  {
    id: 'qq',
    labelKey: 'profileFields.qq',
    icon: 'chatbubble-ellipses',
    color: 'blue',
  },
];

export type VisibleProfileContact = ProfileContactField & { value: string };

/**
 * 把后端裁决过的联系方式摊成可渲染的行。
 *
 * 唯一的过滤条件是「有非空值」—— 后端 applyProfilePrivacy 已经按对方的
 * showPhone / showEmail / showWechat / showQQ 把关掉的字段置成 null 了，客户端
 * 再叠一层判断只会和服务端打架（见 data/profiles.ts 的说明）。空字符串与纯空白
 * 也算没有：用户清空过某个字段时列里留的是 ''，展示成一行空白比不展示更糟。
 */
export function getVisibleProfileContacts(
  contact: ProfileContact | null | undefined,
): VisibleProfileContact[] {
  if (!contact) return [];

  return PROFILE_CONTACT_FIELDS.reduce<VisibleProfileContact[]>(
    (rows, field) => {
      const value = contact[field.id]?.trim();
      return value ? [...rows, { ...field, value }] : rows;
    },
    [],
  );
}
