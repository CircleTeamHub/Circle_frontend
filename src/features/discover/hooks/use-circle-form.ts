import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  CIRCLE_CREDIT_OPTIONS_VALUES,
  CIRCLE_MAX_TAGS,
  CIRCLE_VIP_OPTIONS_VALUES,
  type CircleCreditOption,
  type CircleVipOption,
} from '@/features/discover/constants/circle-form';

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
  tags: string[];
  tagInput: string;
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
  tagInput: '',
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
  setTagInput: (value: string) => void;
  setJoinFancyRestriction: (value: boolean) => void;
  setMemberCanPost: (value: boolean) => void;
  setRequireJoinApproval: (value: boolean) => void;
  toggleCategory: (value: string) => void;
  handleAddCustomCategory: () => void;
  handlePickAvatar: () => Promise<void>;
  handleAddTag: () => void;
  handleRemoveTag: (index: number) => void;
  cycleVip: () => void;
  cycleCredit: () => void;
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
  const setTagInput = useCallback(
    (value: string) => setState((s) => ({ ...s, tagInput: value })),
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setState((s) => ({ ...s, avatarUri: uri, pickedAvatarUri: uri }));
  }, []);

  const handleAddTag = useCallback(() => {
    setState((s) => {
      const tag = s.tagInput.trim();
      if (!tag || s.tags.length >= CIRCLE_MAX_TAGS || s.tags.includes(tag))
        return s;
      return { ...s, tags: [...s.tags, tag], tagInput: '' };
    });
  }, []);

  const handleRemoveTag = useCallback((index: number) => {
    setState((s) => ({
      ...s,
      tags: s.tags.filter((_, currentIndex) => currentIndex !== index),
    }));
  }, []);

  const cycleVip = useCallback(() => {
    setState((s) => {
      const idx = CIRCLE_VIP_OPTIONS_VALUES.indexOf(
        s.joinVipRestriction as CircleVipOption,
      );
      const next =
        CIRCLE_VIP_OPTIONS_VALUES[
          (idx + 1) % CIRCLE_VIP_OPTIONS_VALUES.length
        ] ?? null;
      return { ...s, joinVipRestriction: next };
    });
  }, []);

  const cycleCredit = useCallback(() => {
    setState((s) => {
      const idx = CIRCLE_CREDIT_OPTIONS_VALUES.indexOf(
        s.joinCreditRestriction as CircleCreditOption,
      );
      const next =
        CIRCLE_CREDIT_OPTIONS_VALUES[
          (idx + 1) % CIRCLE_CREDIT_OPTIONS_VALUES.length
        ] ?? null;
      return { ...s, joinCreditRestriction: next };
    });
  }, []);

  const hydrate = useCallback((initial: Partial<CircleFormState>) => {
    setState((s) => ({ ...s, ...initial }));
  }, []);

  return {
    ...state,
    setName,
    setCustomCategoryInput,
    setDescription,
    setRules,
    setTagInput,
    setJoinFancyRestriction,
    setMemberCanPost,
    setRequireJoinApproval,
    toggleCategory,
    handleAddCustomCategory,
    handlePickAvatar,
    handleAddTag,
    handleRemoveTag,
    cycleVip,
    cycleCredit,
    hydrate,
  };
}
