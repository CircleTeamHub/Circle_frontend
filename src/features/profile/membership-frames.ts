import type { ImageSourcePropType } from 'react-native';
import { getMembershipTierForVipLevel } from '@/features/profile/membership-plans';
import { normalizeAvatarFrameImageUrl } from '@/services/api/utils';
import type { AvatarFrameAppearance } from '@/types';

// 会员头像框(assets/frames/*.png,AI 插画 + normalize-avatar-frame.py 归一):
//   钻石 = 铂银冰晶环 + 银翼托蓝宝珠;超级 = 鎏金紫绸带环 + 金冠 + 紫宝石。
// 素材为正方形透明 PNG,内孔直径占画布 62.5%(1/1.6)——华丽装饰(冠/翼/晶簇)
// 需要更大的外溢画布;叠放时框尺寸 = 头像尺寸 × AVATAR_FRAME_SCALE,居中对齐。
const FRAME_ASSETS = {
  diamond: require('../../../assets/frames/diamond.png') as ImageSourcePropType,
  super: require('../../../assets/frames/super.png') as ImageSourcePropType,
} as const;

export const AVATAR_FRAME_SCALE = 1.6;

// 列表 / 聊天等密集场景的紧凑占位系数:带框头像总尺寸 = size × 此值(而非默认 1.6),
// 让带框头像只比普通头像略大、不喧宾夺主(照片相应 = size × 此值 / 1.6)。想再调大/小改这一个数即可。
export const AVATAR_FRAME_COMPACT_SCALE = 1.2;

/** Resolve an equipped frame, preferring bundled assets for stable membership keys. */
export function getAvatarFrameSource(
  frame: AvatarFrameAppearance | null | undefined,
): ImageSourcePropType | null {
  if (!frame) {
    return null;
  }
  if (frame.key === 'membership-diamond') {
    return FRAME_ASSETS.diamond;
  }
  if (frame.key === 'membership-super') {
    return FRAME_ASSETS.super;
  }
  const remoteUrl = normalizeAvatarFrameImageUrl(frame.imageUrl);
  return remoteUrl ? { uri: remoteUrl } : null;
}

/** 按 vipLevel 取会员头像框;仅钻石/超级有框,其余档位与非会员返回 null。 */
export function getMembershipFrameAsset(
  vipLevel: number | null | undefined,
): ImageSourcePropType | null {
  const tier = vipLevel != null ? getMembershipTierForVipLevel(vipLevel) : null;
  return tier === 'diamond' || tier === 'super' ? FRAME_ASSETS[tier] : null;
}
