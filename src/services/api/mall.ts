import { apiClient } from '@/services/api/client';

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

export type MallProduct = {
  id: string;
  // i18n key resolved at render via t(); backend may also send a display string,
  // which t() passes through unchanged for a missing key.
  nameKey: string;
  icon: string;
  color: string;
  action: MallProductAction;
};

export type MallSection = {
  id: string;
  // i18n key resolved at render via t(); see MallProduct.nameKey.
  titleKey: string;
  products: MallProduct[];
};

export async function fetchMallSections() {
  return apiClient<MallSection[]>('/mall/sections');
}
