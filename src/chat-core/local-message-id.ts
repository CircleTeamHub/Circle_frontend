/**
 * 乐观消息的临时 id。
 *
 * 发送时先按 `local:<deliveryId>` 把气泡放进时间线(client.ts 的 sendWithOptimism /
 * 媒体发送两处),ack 回来后 store 按 d 对账、换成服务端的真 id。在那之前这条消息
 * 在服务端根本不存在,任何「拿 id 去问服务端」的动作(收藏、引用、举报……)都只会
 * 拿到一个 400/404 —— 而 catch 提示的是「请重试」,可重试永远不会成功。
 *
 * 前缀收在这里,判定的调用点不要各写一次字符串字面量:写错一个字母不会报错,
 * 只会让守卫静默失效。client.ts 的两处生成点仍是模板字面量(那两个文件在测试里
 * 跑在一个严格的 require 白名单沙箱里),由 test/chat-detail-screen.test.js 的
 * 断言把两边钉在一起。
 */
export const LOCAL_MESSAGE_ID_PREFIX = 'local:';

/** 这条 id 还是本地占位(服务端还没给出真 id)。 */
export function isLocalMessageId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_MESSAGE_ID_PREFIX);
}
