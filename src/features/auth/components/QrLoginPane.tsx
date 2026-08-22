import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { buildQrUrl } from '@/features/qr/qr-payload';
import {
  createQrLoginSession,
  pollQrLoginStatus,
  type QrLoginSession,
} from '@/services/api/qr-login';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/**
 * 登录页的「扫码登录」面板（桌面网页版专属入口）。
 *
 * 生命周期：挂载即建会话 → 渲染二维码（与名片/群码同一深链格式，手机端
 * 现有扫码器直接吃）→ 1.5s 轮询；手机确认后首个轮询拿到 token 交给
 * onTokens（use-auth.completeQrLogin，与密码登录同一收尾链）。收尾失败同样
 * 落到失败态 —— 二维码亮着却不再轮询是最糟的状态。过期给刷新按钮，
 * 不自动无限续（避免后台标签页里静默轰炸接口）。
 */
// 4s keeps confirmation responsive while allowing several users behind one
// office/carrier NAT to share the backend's aggregate IP abuse ceiling.
const POLL_INTERVAL_MS = 4_000;
const QR_SIZE = 200;

type PaneStatus = 'loading' | 'active' | 'expired' | 'failed';

interface QrLoginPaneProps {
  /**
   * 收尾回调。返回 false = 收尾失败（拉用户信息或落 session 出错），
   * 面板转失败态给出重新扫码的出路。
   */
  onTokens: (tokens: {
    accessToken: string;
    refreshToken: string;
  }) => Promise<boolean>;
}

export function QrLoginPane({ onTokens }: QrLoginPaneProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [status, setStatus] = useState<PaneStatus>('loading');
  const [session, setSession] = useState<QrLoginSession | null>(null);
  // onTokens 进 ref：轮询定时器不因父组件重渲染而重建。
  const onTokensRef = useRef(onTokens);
  onTokensRef.current = onTokens;
  const generationRef = useRef(0);

  const startSession = useCallback(async () => {
    const generation = ++generationRef.current;
    setStatus('loading');
    setSession(null);
    try {
      const created = await createQrLoginSession();
      if (generationRef.current !== generation) return;
      if (
        !created.requestDevice?.trim() ||
        !/^\d{6}$/.test(created.verificationCode)
      ) {
        throw new Error('QR login confirmation context is missing');
      }
      setSession(created);
      setStatus('active');
    } catch {
      if (generationRef.current !== generation) return;
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    void startSession();
    return () => {
      // 失活所有在飞回调（组件卸载 = 世代作废）。
      generationRef.current += 1;
    };
  }, [startSession]);

  useEffect(() => {
    if (status !== 'active' || !session) return;
    const generation = generationRef.current;
    const expiresAtMs = Date.parse(session.expiresAt);
    let inFlight = false;
    const timer = setInterval(async () => {
      // 客户端自己也盯着有效期。断网时每一发轮询都被 catch 吞掉,服务端那句
      // EXPIRED 永远送不到 —— 面板会挂着一张早就失效的码一直等下去,用户扫了
      // 也没反应,还看不出为什么。
      //
      // 这一步放在 inFlight 之前:离线时上一发请求可能一直挂着不回来,
      // 放在后面就永远轮不到执行。
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        clearInterval(timer);
        setStatus('expired');
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await pollQrLoginStatus(session.qrToken, session.pollKey);
        if (generationRef.current !== generation) return;
        if (result.status === 'APPROVED') {
          clearInterval(timer);
          // 必须等收尾结果。不等的话，一旦 /auth/me 或落 session 失败，
          // 轮询已停、二维码还亮着 —— 用户对着一张永远不会生效的码干等，
          // 再扫一次也没用（服务端那次消费已经发生）。
          const ok = await onTokensRef.current(result.tokens).catch(() => false);
          if (generationRef.current !== generation) return;
          if (!ok) setStatus('failed');
        } else if (result.status === 'EXPIRED') {
          clearInterval(timer);
          setStatus('expired');
        }
      } catch {
        // 单次轮询失败（网络抖动）不终止；到期由服务端状态兜底。
      } finally {
        inFlight = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [session, status]);

  return (
    <View style={s.root}>
      <View style={[s.qrCard, { backgroundColor: colors.white }]}>
        {status === 'active' && session ? (
          <QRCode value={buildQrUrl(session.qrToken)} size={QR_SIZE} />
        ) : status === 'loading' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <View style={s.expiredBox}>
            <Text style={[s.expiredText, { color: colors.textSecondary }]}>
              {status === 'failed'
                ? t('auth.qrLoginFailed', { defaultValue: '二维码获取失败' })
                : t('auth.qrLoginExpired', { defaultValue: '二维码已过期' })}
            </Text>
            <Pressable
              style={[s.refreshButton, { backgroundColor: colors.primary }]}
              onPress={() => void startSession()}
              accessibilityRole="button"
              accessibilityLabel={t('auth.qrLoginRefresh', {
                defaultValue: '刷新二维码',
              })}
            >
              <Text style={[s.refreshText, { color: colors.white }]}>
                {t('auth.qrLoginRefresh', { defaultValue: '刷新二维码' })}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      {status === 'active' && session ? (
        <View style={s.verificationBox}>
          <Text style={[s.verificationLabel, { color: colors.textSecondary }]}>
            {t('auth.qrLoginVerificationLabel', {
              defaultValue: '手机确认码',
            })}
          </Text>
          <Text style={[s.verificationCode, { color: colors.text }]}>
            {session.verificationCode}
          </Text>
          <Text style={[s.deviceText, { color: colors.textSecondary }]}>
            {session.requestDevice}
          </Text>
        </View>
      ) : null}
      <Text style={[s.hint, { color: colors.textSecondary }]}>
        {t('auth.qrLoginHint', {
          defaultValue: '打开手机 App 扫一扫，确认后自动登录',
        })}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
  },
  qrCard: {
    width: QR_SIZE + Spacing.lg * 2,
    height: QR_SIZE + Spacing.lg * 2,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiredBox: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  expiredText: {
    ...Typography.body,
    textAlign: 'center',
  },
  refreshButton: {
    paddingHorizontal: Spacing.lg,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: {
    ...Typography.body,
    fontWeight: '600',
  },
  hint: {
    ...Typography.bodyRegular,
    textAlign: 'center',
  },
  verificationBox: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  verificationLabel: {
    ...Typography.small,
  },
  verificationCode: {
    ...Typography.h2,
    letterSpacing: 6,
    fontVariant: ['tabular-nums'],
  },
  deviceText: {
    ...Typography.small,
    textAlign: 'center',
  },
});
