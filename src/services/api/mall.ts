import { apiClient } from '@/services/api/client';
import i18n from '@/i18n';
import { expectShape, isNonEmptyString, isPlainObject } from '@/utils/validate';

// Mall 商品的 action 枚举与后端 mall.service.ts 的字符串集合一一对应。
// 新增 action 时两端要一起改 —— 加 `string` 兜底会让消费端的 switch 漏掉新 case。
export type MallProductAction =
  | 'avatar-frame'
  | 'buy-code'
  | 'experience'
  | 'fancy-number'
  | 'fancy-number-renew'
  | 'group-expansion'
  | 'membership'
  | 'recharge-card-create'
  | 'recharge-card-list'
  | 'redeem-code'
  | 'wallet';

// ---- 后端 wire 形状（GET /mall/sections，与 circle_be src/mall/mall.service.ts 对齐）----
// 后端发的是 name / title（显示串），不是 nameKey / titleKey。屏幕不直接消费这个形状。
type MallProductDTO = {
  id: string;
  name: string;
  icon: string;
  color: string;
  action: MallProductAction;
};
type MallSectionDTO = {
  id: string;
  title: string;
  products: MallProductDTO[];
};

// ---- 屏幕消费的域模型 ----
// nameKey/titleKey 由 id 映射到本地 i18n key；defaultName/defaultTitle 保留后端显示串，
// 作为 t() 的 defaultValue —— 后端新增未映射的 id 时回落到后端文案，永不空白。
export type MallProduct = {
  id: string;
  nameKey: string;
  defaultName: string;
  icon: string;
  color: string;
  action: MallProductAction;
};
export type MallSection = {
  id: string;
  titleKey: string;
  defaultTitle: string;
  products: MallProduct[];
};

// 本地静态目录 = 单一事实源：既是离线 / 请求失败时的 FALLBACK_SECTIONS，也用来派生
// id → i18n key 的映射表。后端目录与此同构（仅 name/title 是显示串）。
export const FALLBACK_SECTIONS: MallSection[] = [
  {
    id: 'cards',
    titleKey: 'profile.mall.sections.coupons',
    defaultTitle: '我的卡券',
    products: [
      { id: 'fancy-number-card', nameKey: 'profile.mall.items.fancyNumberCard', defaultName: '靓号卡', icon: 'sparkles-outline', color: '#2563EB', action: 'fancy-number' },
      { id: 'group-expansion-card', nameKey: 'profile.mall.items.groupExpansionCard', defaultName: '群扩容卡', icon: 'people-outline', color: '#E11D48', action: 'group-expansion' },
      { id: 'generate-recharge-card', nameKey: 'profile.mall.items.generateRechargeCard', defaultName: '生成充值卡', icon: 'card-outline', color: '#2563EB', action: 'recharge-card-create' },
      { id: 'my-recharge-cards', nameKey: 'profile.mall.items.myRechargeCards', defaultName: '我的充值卡', icon: 'receipt-outline', color: '#2563EB', action: 'recharge-card-list' },
    ],
  },
  {
    id: 'membership',
    titleKey: 'profile.mall.sections.membership',
    defaultTitle: '会员专区',
    products: [
      { id: 'membership-upgrade', nameKey: 'profile.mall.items.membershipRecharge', defaultName: '会员充值', icon: 'diamond-outline', color: '#F59E0B', action: 'membership' },
      { id: 'experience-exchange', nameKey: 'profile.mall.items.exchangeExperience', defaultName: '兑换经验', icon: 'trending-up-outline', color: '#F59E0B', action: 'experience' },
      { id: 'points-recharge', nameKey: 'profile.mall.items.pointsRecharge', defaultName: '积分充值', icon: 'wallet-outline', color: '#F59E0B', action: 'wallet' },
    ],
  },
  {
    id: 'fancy-number',
    titleKey: 'profile.mall.sections.fancyNumber',
    defaultTitle: '靓号专区',
    products: [
      { id: 'choose-fancy-number', nameKey: 'profile.mall.items.chooseFancyNumber', defaultName: '自选靓号', icon: 'ribbon-outline', color: '#E11D48', action: 'fancy-number' },
      { id: 'renew-fancy-number', nameKey: 'profile.mall.items.renewFancyNumber', defaultName: '续费靓号', icon: 'bookmark-outline', color: '#E11D48', action: 'fancy-number-renew' },
    ],
  },
  {
    id: 'points',
    titleKey: 'profile.mall.sections.points',
    defaultTitle: '积分专区',
    products: [
      { id: 'redeem-code', nameKey: 'profile.mall.items.redeemCode', defaultName: '查询&兑换卡密', icon: 'server-outline', color: '#2563EB', action: 'redeem-code' },
      { id: 'buy-code', nameKey: 'profile.mall.items.buyCode', defaultName: '购买卡密', icon: 'bag-handle-outline', color: '#2563EB', action: 'buy-code' },
    ],
  },
  {
    id: 'decoration',
    titleKey: 'profile.mall.sections.decoration',
    defaultTitle: '装扮专区',
    products: [
      { id: 'avatar-frame', nameKey: 'profile.mall.items.avatarFrame', defaultName: '头像框', icon: 'image-outline', color: '#94A3B8', action: 'avatar-frame' },
    ],
  },
];

const SECTION_TITLE_KEY: Record<string, string> = Object.fromEntries(
  FALLBACK_SECTIONS.map((section) => [section.id, section.titleKey]),
);
const PRODUCT_NAME_KEY: Record<string, string> = Object.fromEntries(
  FALLBACK_SECTIONS.flatMap((section) =>
    section.products.map((product) => [product.id, product.nameKey]),
  ),
);

function isMallSectionArray(value: unknown): value is MallSectionDTO[] {
  return (
    Array.isArray(value) &&
    value.every(
      (section) =>
        isPlainObject(section) &&
        isNonEmptyString(section.id) &&
        typeof section.title === 'string' &&
        Array.isArray(section.products) &&
        section.products.every(
          (product) =>
            isPlainObject(product) &&
            isNonEmptyString(product.id) &&
            typeof product.name === 'string',
        ),
    )
  );
}

function toMallProduct(dto: MallProductDTO): MallProduct {
  return {
    id: dto.id,
    nameKey: PRODUCT_NAME_KEY[dto.id] ?? '',
    defaultName: dto.name,
    icon: dto.icon,
    color: dto.color,
    action: dto.action,
  };
}

function toMallSection(dto: MallSectionDTO): MallSection {
  return {
    id: dto.id,
    titleKey: SECTION_TITLE_KEY[dto.id] ?? '',
    defaultTitle: dto.title,
    products: dto.products.map(toMallProduct),
  };
}

export async function fetchMallSections(): Promise<MallSection[]> {
  const raw = await apiClient<unknown>('/mall/sections');
  const sections = expectShape(
    raw,
    isMallSectionArray,
    i18n.t('common.errors.invalidServerResponse', {
      defaultValue: '服务返回了无效数据',
    }),
  );
  return sections.map(toMallSection);
}
