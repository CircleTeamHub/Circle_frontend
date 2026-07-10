import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';

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
  // 提交时 only-if pickedAvatarUri != null 才走上传流程。
  pickedAvatarUri: string | null;
  rules: string;
  // 标签 UI 已从表单移除（与主题分类重复）；字段保留用于 Edit 的 hydrate/提交
  // 透传，避免编辑其它字段时清掉老圈子已有标签。
  tags: string[];
  joinVipRestriction: number | null;
  joinCreditRestriction: number | null;
  joinFancyRestriction: boolean;
  memberCanPost: boolean;
  /** 开 = 加入需担保审核（isPublic=false）；关 = 公开圈秒进（默认）。 */
  requireJoinApproval: boolean;
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
  requireJoinApproval: false,
};

export interface CircleFormApi extends CircleFormState {
  setName: (value: string) => void;
  setCustomCategoryInput: (value: string) => void;
  setDescription: (value: string) => void;
  setRules: (value: string) => void;
  setJoinFancyRestriction: (value: boolean) => void;
  setMemberCanPost: (value: boolean) => void;
  setRequireJoinApproval: (value: boolean) => void;
  // VIP/信用分限制改为 sheet 直选（语义：所选等级及以上可加入）。
  setJoinVipRestriction: (value: number | null) => void;
  setJoinCreditRestriction: (value: number | null) => void;
  toggleCategory: (value: string) => void;
  handleAddCustomCategory: () => void;
  handlePickAvatar: () => Promise<void>;
  // Edit 用：从服务器载入数据后一次性铺到表单上。
  hydrate: (initial: Partial<CircleFormState>) => void;
}

export function useCircleForm(): CircleFormApi {
  const [state, setState] = useState<CircleFormState>(INITIAL_FORM_STATE);

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
  const setRequireJoinApproval = useCallback(
    (value: boolean) =>
      setState((s) => ({ ...s, requireJoinApproval: value })),
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
    const uri = result.assets[0].uri;
    setState((s) => ({ ...s, avatarUri: uri, pickedAvatarUri: uri }));
  }, []);

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
    setRequireJoinApproval,
    setJoinVipRestriction,
    setJoinCreditRestriction,
    toggleCategory,
    handleAddCustomCategory,
    handlePickAvatar,
    hydrate,
  };
}
