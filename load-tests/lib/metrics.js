import { Counter, Rate, Trend } from 'k6/metrics';

export const chatAckMs = new Trend('chat_ack_ms', true);
export const chatDeliveryMs = new Trend('chat_delivery_ms', true);
export const chatSendFailed = new Rate('chat_send_failed');
export const chatSent = new Counter('chat_sent');
export const chatDelivered = new Counter('chat_delivered');
export const joinFailed = new Rate('join_failed');
export const joinLatencyMs = new Trend('join_latency_ms', true);
