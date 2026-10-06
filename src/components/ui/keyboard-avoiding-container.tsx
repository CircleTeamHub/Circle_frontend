import { KeyboardAvoidingView, type KeyboardAvoidingViewProps } from 'react-native';

/**
 * 全 App 唯一的键盘避让容器：键盘弹起时给底部加 padding，把输入框和底部按钮顶到键盘上方。
 *
 * 两端都走 padding，别再给 Android 传 behavior=undefined：Android 开了 edge-to-edge
 * （android/gradle.properties edgeToEdgeEnabled=true，Expo SDK 54+ 强制）之后，
 * adjustResize 不会再缩窗口，behavior=undefined 的 KeyboardAvoidingView 只是个普通 View，
 * 键盘会整个盖住输入栏。RN 0.83 在 Android 11+ 按 IME insets 发 keyboardDidShow，
 * 窗口不缩也算得出遮挡高度，Modal 自己的窗口里同样生效（模拟器实测）。
 * 局限：Android 11+ 只在键盘显隐切换时上报一次高度，键盘中途变高（切手写/表情面板）不会跟着调。
 *
 * 遮挡量按容器相对父视图的位置算，容器要从屏幕（或 Modal 窗口）顶端开始铺。页面都是
 * headerShown:false、自绘标题栏，天然满足；不满足时用 keyboardVerticalOffset 补上差值。
 * 同一条链路上只放一层：嵌套时内层按父容器坐标算遮挡，会重复加 padding。
 */
export function KeyboardAvoidingContainer({
  behavior = 'padding',
  ...props
}: KeyboardAvoidingViewProps) {
  return <KeyboardAvoidingView behavior={behavior} {...props} />;
}
