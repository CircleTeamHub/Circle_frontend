function positiveNumber(value, label, fallback) {
  const actual = value ?? fallback;
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return actual;
}

/** 收尾宽限期要引用它，放在这里免得两边各写一个数字然后漂移。 */
export const DEFAULT_ACK_P95_MS = 1500;

export function buildThresholds(input = {}) {
  const ackP95Ms = positiveNumber(input.ackP95Ms, 'ackP95Ms', DEFAULT_ACK_P95_MS);
  const deliveryP95Ms = positiveNumber(input.deliveryP95Ms, 'deliveryP95Ms', 2500);
  const maxFailureRate = positiveNumber(input.maxFailureRate, 'maxFailureRate', 0.02);
  if (maxFailureRate >= 1) throw new Error('maxFailureRate must be less than 1.');
  // 只有真的有独立接收方在收的场景才断言交付延迟。发送方自己的回声不再计入
  // chat_delivery_ms（见 socket-session 的 sentTexts），所以单账号的 chat-send
  // 场景根本收不到样本 —— 那时留着这条阈值只会变成一条永远"通过"的空门禁，
  // 比没有更糟。
  const thresholds = {
    chat_ack_ms: [`p(95)<${ackP95Ms}`],
    chat_send_failed: [`rate<${maxFailureRate}`],
    http_req_failed: [`rate<${maxFailureRate}`],
    checks: ['rate>0.98'],
  };
  if (input.measuresDelivery !== false) {
    thresholds.chat_delivery_ms = [`p(95)<${deliveryP95Ms}`];
  }
  return thresholds;
}
