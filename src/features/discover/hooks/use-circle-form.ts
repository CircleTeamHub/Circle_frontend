import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import {
  useEagerMediaUploads,
  type EagerMediaItem,
} from './use-eager-media-uploads';

/**
 * 头像选中就开始传(见 useEagerMediaUploads),不等填完名称、简介点提交。
 * 相册原图动辄几 MB,先和聊天、动态一样压到长边 2048。
 */
async function uploadCircleAvatar(asset: ImagePicker.ImagePickerAsset, progressKey: string): Promise<string> {
  const fileName = asset.fileName || asset.uri.split('/').pop() || 'avatar.jpg';
  const contentType =
    resolveUploadContentType({ mimeType: asset.mimeType, fileName }) ?? 'image/jpeg';
  const prepared = await prepareChatImageForUpload({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    contentType,
    filename: fileName,
  });
  const presign = await requestUploadPresign({
    filename: sanitizeUploadFilename(prepared.filename),
    contentType: prepared.contentType,
    folder: 'avatars',
    fileUri: prepared.uri,
  });
  await uploadLocalFileToPresignedUrl(
    presign.uploadUrl,
    prepared.contentType,
    prepared.uri,
    presign.requiredHeaders,
    undefined,
    { progressKey, foreground: true },
  );
  return presign.fileUrl;
}

function reportCircleAvatarUploadFailure(error: unknown) {
  reportHandledFailure('circle', 'avatarUpload', error);
}

// Create + Edit 圈子流程共享的表单状态。两个屏幕之前各自维护 ~13 个 useState +
// ~7 个 handler，结构基本一样（见 PR 中 #52）。这里收敛一遍。
// 选择城市仍由 Zustand 的 useCreateCircleFormStore 管理 —— 它跨屏幕共享，不动。
export interface CircleFormState {
  name: string;
  selectedCategories: string[];
  customCategoryInput: string;
  description: string;
  // avatarUri 是当前用于展示的 URI —— Edit 初始为服务器 URL，Create 为 null。
  avatarUri: string | null;
  // pickedAvatarUri 是用户本次从相册选的本地 file://，未选则为 null。
  // 选中即开始上传；提交时 only-if pickedAvatarUri != null 才等 settleAvatar()。
  pickedAvatarUri: string | null;
  rules: string;
  // 标签 UI 已从表单移除（与主题分类重复）；字段保留用于 Edit 的 hydrate/提交
  // 透传，避免编辑其它字段时清掉老圈子已有标签。
  tags: string[];
  joinVipRestriction: number | null;
  joinCreditRestriction: number | null;
  joinFancyRestriction: boolean;
  memberCanPost: boolean;
  // 入圈验证:1 = 关闭(成员邀请即进,宣传期默认),2/5/10 = 需要的担保票数。
  // 建担保单时由服务端快照,改这里不影响在途申请。
  requiredVerifierCount: number;
}

const INITIAL_FORM_STATE: CircleFormState = {
  name: '',
  selectedCategories: [],
  customCategoryInput: '',
  description: '',
  avatarUri: null,
  pickedAvatarUri: null,
  rules: '',
  tags: [],
  joinVipRestriction: null,
  joinCreditRestriction: null,
  joinFancyRestriction: false,
  memberCanPost: true,
  requiredVerifierCount: 1,
};

export interface CircleFormApi extends CircleFormState {
  setName: (value: string) => void;
  setCustomCategoryInput: (value: string) => void;
  setDescription: (value: string) => void;
  setRules: (value: string) => void;
  setJoinFancyRestriction: (value: boolean) => void;
  setMemberCanPost: (value: boolean) => void;
  setRequiredVerifierCount: (value: number) => void;
  // VIP/信用分限制改为 sheet 直选（语义：所选等级及以上可加入）。
  setJoinVipRestriction: (value: number | null) => void;
  setJoinCreditRestriction: (value: number | null) => void;
  toggleCategory: (value: string) => void;
  handleAddCustomCategory: () => void;
  handlePickAvatar: () => Promise<void>;
  /** 本次所选头像的上传状态(缩略图上画进度环 / 失败重试),没选为 null。 */
  avatarUpload: EagerMediaItem | null;
  retryAvatarUpload: () => void;
  /** 等所选头像传完(失败补传一次):成功给 URL,仍失败给 null。 */
  settleAvatar: () => Promise<string | null>;
  // Edit 用：从服务器载入数据后一次性铺到表单上。
  hydrate: (initial: Partial<CircleFormState>) => void;
}

export function useCircleForm(): CircleFormApi {
  const [state, setState] = useState<CircleFormState>(INITIAL_FORM_STATE);
  const {
    items: avatarItems,
    add: addAvatar,
    remove: removeAvatar,
    retry: retryAvatar,
    settle: settleAvatarUpload,
  } = useEagerMediaUploads({
    upload: uploadCircleAvatar,
    onError: reportCircleAvatarUploadFailure,
  });
  const avatarUpload = avatarItems[0] ?? null;

  const setName = useCallback(
    (value: string) => setState((s) => ({ ...s, name: value })),
    [],
  );
  const setCustomCategoryInput = useCallback(
    (value: string) => setState((s) => ({ ...s, customCategoryInput: value })),
    [],
  );
  const setDescription = useCallback(
    (value: string) => setState((s) => ({ ...s, description: value })),
    [],
  );
  const setRules = useCallback(
    (value: string) => setState((s) => ({ ...s, rules: value })),
    [],
  );
  const setJoinFancyRestriction = useCallback(
    (value: boolean) =>
      setState((s) => ({ ...s, joinFancyRestriction: value })),
    [],
  );
  const setMemberCanPost = useCallback(
    (value: boolean) => setState((s) => ({ ...s, memberCanPost: value })),
    [],
  );
  const setRequiredVerifierCount = useCallback(
    (value: number) =>
      setState((s) => ({ ...s, requiredVerifierCount: value })),
    [],
  );

  const toggleCategory = useCallback((value: string) => {
    setState((s) => ({
      ...s,
      selectedCategories: s.selectedCategories.includes(value)
        ? s.selectedCategories.filter((item) => item !== value)
        : [...s.selectedCategories, value],
    }));
  }, []);

  const handleAddCustomCategory = useCallback(() => {
    setState((s) => {
      const value = s.customCategoryInput.trim();
      if (!value || s.selectedCategories.includes(value)) return s;
      return {
        ...s,
        selectedCategories: [...s.selectedCategories, value],
        customCategoryInput: '',
      };
    });
  }, []);

  const handlePickAvatar = useCallback(async () => {
    // 不开 allowsEditing：iOS 上开了会从秒开的 PHPicker 回退到老的
    // UIImagePickerController（呈现时同步枚举整个照片库 + 要相册权限），
    // 照片库大时点击后要卡好几秒才弹出。头像全程圆角 cover-fit 展示，
    // 非正方形原图没有视觉差异。
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setState((s) => ({ ...s, avatarUri: asset.uri, pickedAvatarUri: asset.uri }));
    avatarItems.forEach((item) => removeAvatar(item.id));
    addAvatar([asset], 1);
  }, [addAvatar, avatarItems, removeAvatar]);

  const retryAvatarUpload = useCallback(() => {
    if (avatarUpload) retryAvatar(avatarUpload.id);
  }, [avatarUpload, retryAvatar]);

  const settleAvatar = useCallback(async () => {
    const settled = await settleAvatarUpload();
    return settled.ok ? settled.results[0] ?? null : null;
  }, [settleAvatarUpload]);

  const setJoinVipRestriction = useCallback(
    (value: number | null) =>
      setState((s) => ({ ...s, joinVipRestriction: value })),
    [],
  );

  const setJoinCreditRestriction = useCallback(
    (value: number | null) =>
      setState((s) => ({ ...s, joinCreditRestriction: value })),
    [],
  );

  const hydrate = useCallback((initial: Partial<CircleFormState>) => {
    setState((s) => ({ ...s, ...initial }));
  }, []);

  return {
    ...state,
    setName,
    setCustomCategoryInput,
    setDescription,
    setRules,
    setJoinFancyRestriction,
    setMemberCanPost,
    setRequiredVerifierCount,
    setJoinVipRestriction,
    setJoinCreditRestriction,
    toggleCategory,
    handleAddCustomCategory,
    handlePickAvatar,
    avatarUpload,
    retryAvatarUpload,
    settleAvatar,
    hydrate,
  };
}
