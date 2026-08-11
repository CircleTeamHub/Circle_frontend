// 纯选择器,与 supportConfigStore 分开:store 会拉起 API client(进而是 AsyncStorage),
// 而这里只有 `import type`(编译期擦除),所以屏幕的单测可以 mock 掉 store、却仍然跑
// 真实的选择逻辑 —— 「没配则空数组、绝不回退默认账号」这条规则本身就是要验的行为。
import type {
  SupportAgent,
  SupportCategoryId,
  SupportConfig,
} from '@/services/api/support';

/**
 * 取某类客服。拉取失败或后端没配时返回空数组 —— 调用方渲染空态。
 *
 * 不做任何默认账号回退:回退到一个不存在的账号(历史上的 imAdmin)会让入口
 * 渲染成功、一点就被后端以「用户不存在」拒绝,比直接显示空态更难排查。
 */
export function selectSupportAgents(
  config: SupportConfig | null,
  category: SupportCategoryId,
): SupportAgent[] {
  return config?.[category] ?? [];
}
