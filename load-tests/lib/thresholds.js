function positiveNumber(value, label, fallback) {
  const actual = value ?? fallback;
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return actual;
}

export function buildThresholds(input = {}) {
  const ackP95Ms = positiveNumber(input.ackP95Ms, 'ackP95Ms', 1500);
  const deliveryP95Ms = positiveNumber(input.deliveryP95Ms, 'deliveryP95Ms', 2500);
  const maxFailureRate = positiveNumber(input.maxFailureRate, 'maxFailureRate', 0.02);
  if (maxFailureRate >= 1) throw new Error('maxFailureRate must be less than 1.');
  return {
    chat_ack_ms: [`p(95)<${ackP95Ms}`],
    chat_delivery_ms: [`p(95)<${deliveryP95Ms}`],
    chat_send_failed: [`rate<${maxFailureRate}`],
    http_req_failed: [`rate<${maxFailureRate}`],
    checks: ['rate>0.98'],
  };
}
