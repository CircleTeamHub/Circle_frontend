type EditableFieldId =
  | 'avatar'
  | 'nickname'
  | 'city'
  | 'gender'
  | 'birthday'
  | 'bio'
  | 'wechat'
  | 'phone'
  | 'qq';

type UnsupportedFieldId =
  | 'frame'
  | 'password'
  | 'security-code';

type EditableField = {
  id: EditableFieldId;
  label: string;
  rowType?: 'avatar' | 'text';
  editable: true;
  valueKey:
    | 'avatarUrl'
    | 'nickname'
    | 'city'
    | 'gender'
    | 'birthday'
    | 'persona'
    | 'wechat'
    | 'phoneNumber'
    | 'qq';
  payloadKey:
    | 'avatarUrl'
    | 'nickname'
    | 'city'
    | 'gender'
    | 'birthday'
    | 'persona'
    | 'wechat'
    | 'phoneNumber'
    | 'qq';
  title: string;
  placeholder: string;
  emptyValueLabel: string;
  editorType?: 'text' | 'gender' | 'date' | 'avatar' | 'city';
  multiline?: boolean;
  keyboardType?: 'default' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences';
};

type UnsupportedField = {
  id: UnsupportedFieldId;
  label: string;
  rowType?: 'avatar' | 'text';
  editable: false;
  emptyValueLabel?: string;
  unsupportedMessage: string;
};

export const PROFILE_EDIT_FIELDS = [
  {
    id: 'avatar',
    label: '头像',
    rowType: 'avatar',
    editable: true,
    valueKey: 'avatarUrl',
    payloadKey: 'avatarUrl',
    title: '修改头像',
    placeholder: '请选择头像',
    emptyValueLabel: '未设置',
    editorType: 'avatar',
  },
  {
    id: 'frame',
    label: '头像框',
    rowType: 'text',
    editable: false,
    emptyValueLabel: '无',
    unsupportedMessage: '头像框功能暂未接入。',
  },
  {
    id: 'nickname',
    label: '昵称',
    rowType: 'text',
    editable: true,
    valueKey: 'nickname',
    payloadKey: 'nickname',
    title: '修改昵称',
    placeholder: '请输入昵称',
    emptyValueLabel: '未设置',
    autoCapitalize: 'none',
  },
  {
    id: 'city',
    label: '地区',
    rowType: 'text',
    editable: true,
    valueKey: 'city',
    payloadKey: 'city',
    title: '选择地区',
    placeholder: '请选择城市',
    emptyValueLabel: '未设置',
    editorType: 'city',
    autoCapitalize: 'none',
  },
  {
    id: 'gender',
    label: '性别',
    rowType: 'text',
    editable: true,
    valueKey: 'gender',
    payloadKey: 'gender',
    title: '修改性别',
    placeholder: '请选择性别',
    emptyValueLabel: '未设置',
    editorType: 'gender',
    autoCapitalize: 'none',
  },
  {
    id: 'birthday',
    label: '生日',
    rowType: 'text',
    editable: true,
    valueKey: 'birthday',
    payloadKey: 'birthday',
    title: '修改生日',
    placeholder: '请选择生日',
    emptyValueLabel: '未设置',
    editorType: 'date',
    autoCapitalize: 'none',
  },
  {
    id: 'bio',
    label: '个人简介',
    rowType: 'text',
    editable: true,
    valueKey: 'persona',
    payloadKey: 'persona',
    title: '修改个人简介',
    placeholder: '介绍一下你自己',
    emptyValueLabel: '未填写',
    multiline: true,
    autoCapitalize: 'sentences',
  },
  {
    id: 'wechat',
    label: '绑定微信',
    rowType: 'text',
    editable: true,
    valueKey: 'wechat',
    payloadKey: 'wechat',
    title: '绑定微信',
    placeholder: '请输入微信号',
    emptyValueLabel: '未绑定',
    autoCapitalize: 'none',
  },
  {
    id: 'phone',
    label: '绑定手机号',
    rowType: 'text',
    editable: true,
    valueKey: 'phoneNumber',
    payloadKey: 'phoneNumber',
    title: '绑定手机号',
    placeholder: '请输入手机号',
    emptyValueLabel: '未绑定',
    keyboardType: 'phone-pad',
    autoCapitalize: 'none',
  },
  {
    id: 'qq',
    label: '绑定QQ号',
    rowType: 'text',
    editable: true,
    valueKey: 'qq',
    payloadKey: 'qq',
    title: '绑定QQ号',
    placeholder: '请输入QQ号',
    emptyValueLabel: '未绑定',
    autoCapitalize: 'none',
  },
  {
    id: 'password',
    label: '修改登录密码',
    rowType: 'text',
    editable: false,
    unsupportedMessage: '请通过账号设置页面修改密码。',
  },
  {
    id: 'security-code',
    label: '登录安全码',
    rowType: 'text',
    editable: false,
    emptyValueLabel: '点击修改',
    unsupportedMessage: '登录安全码功能暂未接入。',
  },
] satisfies Array<EditableField | UnsupportedField>;

export function getProfileEditField(fieldId: string) {
  return PROFILE_EDIT_FIELDS.find((field) => field.id === fieldId);
}

function normalizeGenderValue(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized === '男' || normalized === 'male') {
    return 'male';
  }

  if (normalized === '女' || normalized === 'female') {
    return 'female';
  }

  if (normalized === '其他' || normalized === 'other') {
    return 'other';
  }

  return 'unset';
}

function normalizeBirthdayValue(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return '';
  }

  const isoMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoMatch ? isoMatch[1] : normalized;
}

function isValidBirthday(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!year || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatProfileFieldValue(fieldId: string, value: string) {
  const field = getProfileEditField(fieldId);
  const normalized = value.trim();

  if (!field) {
    return normalized;
  }

  if (fieldId === 'gender') {
    switch (normalizeGenderValue(normalized)) {
      case 'male':
        return '男';
      case 'female':
        return '女';
      case 'other':
        return '其他';
      default:
        return field.emptyValueLabel;
    }
  }

  if (fieldId === 'birthday') {
    return normalizeBirthdayValue(normalized) || field.emptyValueLabel || '';
  }

  return normalized || field.emptyValueLabel || '';
}

export function validateProfileFieldValue(fieldId: string, value: string) {
  const normalized = value.trim();

  switch (fieldId) {
    case 'nickname':
      if (!normalized) {
        return '昵称不能为空';
      }
      if (normalized.length > 24) {
        return '昵称最多 24 个字符';
      }
      return null;
    case 'gender':
      return ['male', 'female', 'other', 'unset', '男', '女', '其他', '未设置'].includes(normalized || '未设置')
        ? null
        : '性别只能选择男、女或未设置';
    case 'birthday':
      if (!normalized) {
        return null;
      }
      return isValidBirthday(normalizeBirthdayValue(normalized))
        ? null
        : '生日格式不正确，请选择有效日期';
    case 'city':
      if (!normalized) {
        return null;
      }
      return normalized.length >= 2 && normalized.length <= 30
        ? null
        : '地区格式不正确';
    case 'bio':
      return normalized.length <= 200 ? null : '个人简介最多 200 个字符';
    case 'wechat':
      if (!normalized) {
        return null;
      }
      return /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(normalized)
        ? null
        : '微信号格式不正确';
    case 'phone':
      if (!normalized) {
        return null;
      }
      return /^1\d{10}$/.test(normalized) ? null : '手机号格式不正确';
    case 'qq':
      if (!normalized) {
        return null;
      }
      return /^[1-9]\d{4,11}$/.test(normalized) ? null : 'QQ 号格式不正确';
    default:
      return null;
  }
}

export function toProfileUpdatePayload(fieldId: string, value: string) {
  const field = getProfileEditField(fieldId);

  if (!field || !field.editable) {
    return {};
  }

  const payload: Record<string, string> = {};
  const normalized = value.trim();

  if (fieldId === 'gender') {
    payload[field.payloadKey] = normalizeGenderValue(normalized);
    return payload;
  }

  if (fieldId === 'birthday') {
    payload[field.payloadKey] = normalizeBirthdayValue(normalized);
    return payload;
  }

  payload[field.payloadKey] = normalized;
  return payload;
}
