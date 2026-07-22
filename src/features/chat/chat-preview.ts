import { getIMErrorCode } from '@/im/error-codes';

/**
 * 是否应降级到聊天预览模式：IM 在当前环境不可用（无 native 模块 / 连接未就绪）。
 *
 * 按稳定 code 判定而不是匹配错误文案 —— 那两条文案是 i18n 清扫的遗留目标，
 * 文案一动预览模式就会静默失效，且没有任何测试会失败（#99 的教训）。
 */
export function shouldOpenChatPreview(error: unknown) {
  return getIMErrorCode(error) !== null;
}
