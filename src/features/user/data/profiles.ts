export interface UserProfileData {
  id: string;
  name: string;
  accountId: string;
  avatarUrl?: string;
  memberLabel: string;
  badges: string[];
  gender?: string | null;
  city?: string | null;
  signature: string;
  phone: string;
  remarkHint?: string;
}

const USER_PROFILES: Record<string, UserProfileData> = {
  me: {
    id: 'me',
    name: 'ddddd',
    accountId: '134273011l',
    memberLabel: '普通用户',
    badges: ['普通用户', '年度会员'],
    gender: 'male',
    city: '杭州',
    signature: '你好呀，欢迎来找我聊天。',
    phone: '137 6021 0281',
  },
  'chen-siqi': {
    id: 'chen-siqi',
    name: '陈思琪',
    accountId: '128128',
    memberLabel: '普通用户',
    avatarUrl:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200',
    badges: ['VIP6', '魅力值', '深圳活跃'],
    gender: 'female',
    city: '深圳',
    signature: '个人签名：🌹 137 6021 0281',
    phone: '137 6021 0281',
    remarkHint: '深圳乔酷',
  },
  'zhang-mingyuan': {
    id: 'zhang-mingyuan',
    name: '张明远',
    accountId: '932041',
    memberLabel: '普通用户',
    avatarUrl:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200',
    badges: ['产品经理', '同城活跃'],
    gender: 'male',
    city: '上海',
    signature: '个人签名：昨日文件已经上传了 :)',
    phone: '138 2210 8821',
  },
  'li-xiaoting': {
    id: 'li-xiaoting',
    name: '李晓婷',
    accountId: '678212',
    memberLabel: '普通用户',
    avatarUrl:
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200',
    badges: ['设计师', '本周在线'],
    gender: 'female',
    city: '成都',
    signature: '个人签名：你觉得这个设计怎么样？',
    phone: '139 1108 3201',
  },
  'zhao-tianyu': {
    id: 'zhao-tianyu',
    name: '赵天宇',
    accountId: '290182',
    memberLabel: '普通用户',
    badges: ['摄影爱好者'],
    gender: 'male',
    city: '北京',
    signature: '个人签名：哈哈太搞笑了',
    phone: '186 2001 1102',
  },
  'lin-meiqi': {
    id: 'lin-meiqi',
    name: '林美琪',
    accountId: '447801',
    memberLabel: '普通用户',
    badges: ['已认证'],
    gender: 'female',
    city: '苏州',
    signature: '个人签名：有空的时候帮我打个电话',
    phone: '136 8812 4480',
  },
  'wang-haoran': {
    id: 'wang-haoran',
    name: '王浩然',
    accountId: '220918',
    memberLabel: '普通用户',
    badges: ['联系人'],
    gender: 'male',
    city: '深圳',
    signature: '个人签名：好的，健身房见！',
    phone: '188 0088 1008',
  },
  'zhou-zihan': {
    id: 'zhou-zihan',
    name: '周子涵',
    accountId: '150620',
    memberLabel: '普通用户',
    badges: ['同城推荐'],
    gender: 'female',
    city: '杭州',
    signature: '个人签名：周末羽毛球局随时约。',
    phone: '135 9902 3321',
  },
};

const NAME_TO_ID: Record<string, string> = {
  ddddd: 'me',
  陈思琪: 'chen-siqi',
  张明远: 'zhang-mingyuan',
  李晓婷: 'li-xiaoting',
  赵天宇: 'zhao-tianyu',
  林美琪: 'lin-meiqi',
  王浩然: 'wang-haoran',
  周子涵: 'zhou-zihan',
};

export function getUserProfileIdByName(name: string): string {
  return NAME_TO_ID[name] ?? 'unknown';
}

export function getUserProfileById(
  id: string,
  fallbackName?: string,
): UserProfileData {
  const profile = USER_PROFILES[id];

  if (profile) {
    return profile;
  }

  const name = fallbackName?.trim() || '未命名用户';

  return {
    id,
    name,
    accountId: '000000',
    memberLabel: '普通用户',
    badges: ['普通用户'],
    gender: null,
    city: null,
    signature: `个人签名：${name} 的详细信息暂未完善`,
    phone: '未公开',
  };
}
