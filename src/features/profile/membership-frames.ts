import type { ImageSourcePropType } from 'react-native';
import { getMembershipTierForVipLevel } from '@/features/profile/membership-plans';

// 会员头像框(assets/frames/*.png,AI 插画 + normalize-avatar-frame.py 归一):
//   钻石 = 铂银冰晶环 + 银翼托蓝宝珠;超级 = 鎏金紫绸带环 + 金冠 + 紫宝石。
// 素材为正方形透明 PNG,内孔直径占画布 62.5%(1/1.6)——华丽装饰(冠/翼/晶簇)
// 需要更大的外溢画布;叠放时框尺寸 = 头像尺寸 × AVATAR_FRAME_SCALE,居中对齐。
const FRAME_ASSETS = {
  diamond: require('../../../assets/frames/diamond.png') as ImageSourcePropType,
  super: require('../../../assets/frames/super.png') as ImageSourcePropType,
} as const;

export const AVATAR_FRAME_SCALE = 1.6;

/** 按 vipLevel 取会员头像框;仅钻石/超级有框,其余档位与非会员返回 null。 */
export function getMembershipFrameAsset(
  vipLevel: number | null | undefined,
): ImageSourcePropType | null {
  const tier = vipLevel != null ? getMembershipTierForVipLevel(vipLevel) : null;
  return tier === 'diamond' || tier === 'super' ? FRAME_ASSETS[tier] : null;
}
