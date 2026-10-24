import type { StyleProp, TextStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

/** 顶档会员名流光的渲染入参。原生端(Skia)与 Web 端(逐字插值)两份实现共用。 */
export interface MemberNameFlowProps {
  name: string;
  /** 回文色带(首尾同色),平铺循环时才没有接缝。 */
  colors: readonly string[];
  /** 根节点共享的动画时钟,0→1 为一圈。 */
  progress: SharedValue<number>;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}
