import i18n from '@/i18n';

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

function buildProfileEditFields() {
  return [
    {
      id: 'avatar',
      label: i18n.t('profileFields.avatar'),
      rowType: 'avatar',
      editable: true,
      valueKey: 'avatarUrl',
      payloadKey: 'avatarUrl',
      title: i18n.t('profileFields.editAvatar'),
      placeholder: i18n.t('profileFields.selectAvatar'),
      emptyValueLabel: i18n.t('profileFields.notSet'),
      editorType: 'avatar',
    },
    {
      id: 'frame',
      label: i18n.t('profileFields.avatarFrame'),
      rowType: 'text',
      editable: false,
      emptyValueLabel: i18n.t('common.none'),
      unsupportedMessage: i18n.t('profileFields.avatarFrameNotSupported'),
    },
    {
      id: 'nickname',
      label: i18n.t('profileFields.nickname'),
      rowType: 'text',
      editable: true,
      valueKey: 'nickname',
      payloadKey: 'nickname',
      title: i18n.t('profileFields.editNickname'),
      placeholder: i18n.t('profileFields.nicknamePlaceholder'),
      emptyValueLabel: i18n.t('profileFields.notSet'),
      autoCapitalize: 'none',
    },
    {
      id: 'city',
      label: i18n.t('profileFields.city'),
      rowType: 'text',
      editable: true,
      valueKey: 'city',
      payloadKey: 'city',
      title: i18n.t('profileFields.selectCity'),
      placeholder: i18n.t('profileFields.cityPlaceholder'),
      emptyValueLabel: i18n.t('profileFields.notSet'),
      editorType: 'city',
      autoCapitalize: 'none',
    },
    {
      id: 'gender',
      label: i18n.t('profileFields.gender'),
      rowType: 'text',
      editable: true,
      valueKey: 'gender',
      payloadKey: 'gender',
      title: i18n.t('profileFields.editGender'),
      placeholder: i18n.t('profileFields.genderPlaceholder'),
      emptyValueLabel: i18n.t('profileFields.genderNotSet'),
      editorType: 'gender',
      autoCapitalize: 'none',
    },
    {
      id: 'birthday',
      label: i18n.t('profileFields.birthday'),
      rowType: 'text',
      editable: true,
      valueKey: 'birthday',
      payloadKey: 'birthday',
      title: i18n.t('profileFields.editBirthday'),
      placeholder: i18n.t('profileFields.birthdayPlaceholder'),
      emptyValueLabel: i18n.t('profileFields.notSet'),
      editorType: 'date',
      autoCapitalize: 'none',
    },
    {
      id: 'bio',
      label: i18n.t('profileFields.bio'),
      rowType: 'text',
      editable: true,
      valueKey: 'persona',
      payloadKey: 'persona',
      title: i18n.t('profileFields.editBio'),
      placeholder: i18n.t('profileFields.bioPlaceholder'),
      emptyValueLabel: i18n.t('profileFields.bioNotSet'),
      multiline: true,
      autoCapitalize: 'sentences',
    },
    {
      id: 'wechat',
      label: i18n.t('profileFields.wechat'),
      rowType: 'text',
      editable: true,
      valueKey: 'wechat',
      payloadKey: 'wechat',
      title: i18n.t('profileFields.wechat'),
      placeholder: i18n.t('profileFields.wechatPlaceholder'),
      emptyValueLabel: i18n.t('profileFields.notBound'),
      autoCapitalize: 'none',
    },
    {
      id: 'phone',
      label: i18n.t('profileFields.phone'),
      rowType: 'text',
      editable: true,
      valueKey: 'phoneNumber',
      payloadKey: 'phoneNumber',
      title: i18n.t('profileFields.phone'),
      placeholder: i18n.t('profileFields.phonePlaceholder'),
      emptyValueLabel: i18n.t('profileFields.notBound'),
      keyboardType: 'phone-pad',
      autoCapitalize: 'none',
    },
    {
      id: 'qq',
      label: i18n.t('profileFields.qq'),
      rowType: 'text',
      editable: true,
      valueKey: 'qq',
      payloadKey: 'qq',
      title: i18n.t('profileFields.qq'),
      placeholder: i18n.t('profileFields.qqPlaceholder'),
      emptyValueLabel: i18n.t('profileFields.notBound'),
      autoCapitalize: 'none',
    },
    {
      id: 'password',
      label: i18n.t('profileFields.password'),
      rowType: 'text',
      editable: false,
      unsupportedMessage: i18n.t('profileFields.passwordNotSupported'),
    },
    {
      id: 'security-code',
      label: i18n.t('profileFields.securityCode'),
      rowType: 'text',
      editable: false,
      emptyValueLabel: i18n.t('profileFields.securityCodeHint'),
      unsupportedMessage: i18n.t('profileFields.securityCodeNotSupported'),
    },
  ] satisfies Array<EditableField | UnsupportedField>;
}

export const PROFILE_EDIT_FIELDS = buildProfileEditFields();

export function getProfileEditFields() {
  return buildProfileEditFields();
}

export function getProfileEditField(fieldId: string) {
  return getProfileEditFields().find((field) => field.id === fieldId);
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
        return i18n.t('profileFields.male');
      case 'female':
        return i18n.t('profileFields.female');
      case 'other':
        return i18n.t('profileFields.other');
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
  const normalizedGender = normalized || i18n.t('profileFields.genderNotSet');

  switch (fieldId) {
    case 'nickname':
      if (!normalized) {
        return i18n.t('validation.nicknameEmpty');
      }
      if (normalized.length > 24) {
        return i18n.t('validation.nicknameTooLong');
      }
      return null;
    case 'gender':
      return [
        'male',
        'female',
        'other',
        'unset',
        i18n.t('profileFields.male'),
        i18n.t('profileFields.female'),
        i18n.t('profileFields.other'),
        i18n.t('profileFields.genderNotSet'),
      ].includes(normalizedGender)
        ? null
        : i18n.t('validation.invalidGender');
    case 'birthday':
      if (!normalized) {
        return null;
      }
      return isValidBirthday(normalizeBirthdayValue(normalized))
        ? null
        : i18n.t('validation.invalidBirthday');
    case 'city':
      if (!normalized) {
        return null;
      }
      return normalized.length >= 2 && normalized.length <= 30
        ? null
        : i18n.t('validation.invalidCity');
    case 'bio':
      return normalized.length <= 200 ? null : i18n.t('validation.bioTooLong');
    case 'wechat':
      if (!normalized) {
        return null;
      }
      return /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(normalized)
        ? null
        : i18n.t('validation.invalidWechat');
    case 'phone':
      if (!normalized) {
        return null;
      }
      return /^1\d{10}$/.test(normalized) ? null : i18n.t('validation.invalidPhone');
    case 'qq':
      if (!normalized) {
        return null;
      }
      return /^[1-9]\d{4,11}$/.test(normalized) ? null : i18n.t('validation.invalidQQ');
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
