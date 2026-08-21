import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

/**
 * Web 端的 Alert 宿主。
 *
 * react-native-web 的 `Alert.alert` 是一个空函数 —— 不接管的话，全 App 的
 * 确认/选择对话框（发起通话选类型、删除确认、错误提示……两百多处）在 web
 * 上都会静默失效。localized-alert.ts 在 web 平台把 Alert.alert 指到
 * presentWebAlert；本组件挂在根布局渲染主题化模态。
 *
 * 宿主未挂载的极早期调用先进 pending 队列，挂载时统一放出 —— 不丢弹窗。
 * 多个 Alert 排队逐个展示（与原生"后弹的叠在上面"语义近似但更可控）。
 */

export interface WebAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface WebAlertRequest {
  title: string;
  message?: string;
  buttons: WebAlertButton[];
  /** 点蒙层是否可关闭（关闭时触发 onDismiss，不触发任何按钮）。 */
  cancelable: boolean;
  onDismiss?: () => void;
}

let presenter: ((request: WebAlertRequest) => void) | null = null;
const pending: WebAlertRequest[] = [];

export function presentWebAlert(request: WebAlertRequest): void {
  if (presenter) {
    presenter(request);
  } else {
    pending.push(request);
  }
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: 320,
    maxWidth: '100%',
    borderRadius: Radius.lg,
    paddingTop: Spacing.lg,
    // 按钮列自带分隔线贴到底部，底部不留 padding。
    overflow: 'hidden',
  },
  title: {
    ...Typography.h3,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  message: {
    ...Typography.body,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  cardHeaderless: {
    paddingTop: 0,
  },
  buttonColumn: {
    marginTop: Spacing.lg,
  },
  buttonColumnHeaderless: {
    marginTop: 0,
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
  },
  buttonText: {
    ...Typography.body,
    fontWeight: '600',
  },
});

export function WebAlertHost() {
  const { colors } = useTheme();
  const [queue, setQueue] = useState<WebAlertRequest[]>([]);

  useEffect(() => {
    presenter = (request) => {
      setQueue((current) => [...current, request]);
    };
    if (pending.length > 0) {
      const drained = pending.splice(0, pending.length);
      setQueue((current) => [...current, ...drained]);
    }
    return () => {
      presenter = null;
    };
  }, []);

  const close = useCallback(() => {
    setQueue((current) => current.slice(1));
  }, []);

  const active = queue[0] ?? null;
  if (!active) return null;

  const handleBackdropPress = () => {
    if (!active.cancelable) return;
    close();
    active.onDismiss?.();
  };

  // 菜单式调用(长按图片等)没有标题与正文:去掉为标题预留的上留白。
  const hasHeader = Boolean(active.title || active.message);

  const handleButtonPress = (button: WebAlertButton) => {
    close();
    button.onPress?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleBackdropPress}>
      <Pressable
        style={[s.backdrop, { backgroundColor: colors.overlay }]}
        onPress={handleBackdropPress}
      >
        {/* 卡片本体拦下点击，不让它冒泡到蒙层触发 dismiss。 */}
        <Pressable
          style={[
            s.card,
            !hasHeader && s.cardHeaderless,
            { backgroundColor: colors.surface },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          {/* 菜单式调用（如长按图片）标题为空：不渲染，避免留一条空行。 */}
          {active.title ? (
            <Text style={[s.title, { color: colors.text }]}>{active.title}</Text>
          ) : null}
          {active.message ? (
            <Text style={[s.message, { color: colors.textSecondary }]}>
              {active.message}
            </Text>
          ) : null}
          <View style={[s.buttonColumn, !hasHeader && s.buttonColumnHeaderless]}>
            {active.buttons.map((button, index) => (
              <Pressable
                key={`${button.text}-${index}`}
                style={[s.button, { borderTopColor: colors.divider }]}
                onPress={() => handleButtonPress(button)}
                accessibilityRole="button"
                accessibilityLabel={button.text}
              >
                <Text
                  style={[
                    s.buttonText,
                    {
                      color:
                        button.style === 'destructive'
                          ? colors.error
                          : button.style === 'cancel'
                            ? colors.textSecondary
                            : colors.primary,
                    },
                  ]}
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
