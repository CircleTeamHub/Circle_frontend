import { Platform, Switch, type SwitchProps } from 'react-native';
import { useTheme } from '@/theme';

/**
 * 全 App 统一的开关：关闭态灰轨、打开态品牌色轨、白滑块。
 *
 * 存在的理由不只是省重复 —— react-native-web 的 Switch **打开态只读
 * `activeThumbColor`**（`thumbColor` 仅作用于关闭态）；不传它就退回 RNW
 * 自己的默认色 `#009688`（Material 青绿），于是网页版每个打开的开关都是
 * 绿滑块。轨道色不受影响：`trackColor` 传对象时 RNW 会正确取 `.true`。
 * 这个 prop 不在 RN 的类型里（原生端也不认），所以只在 web 注入。
 */
interface ThemedSwitchProps
  extends Omit<SwitchProps, 'trackColor' | 'thumbColor'> {
  /** 打开态轨道色，默认品牌主色。 */
  tint?: string;
}

export function ThemedSwitch({ tint, ...rest }: ThemedSwitchProps) {
  const { colors } = useTheme();
  const activeTrackColor = tint ?? colors.primary;

  const webActiveThumb =
    Platform.OS === 'web'
      ? // RN 的 SwitchProps 没有这个键，用一次受控断言把它喂给 RNW。
        ({ activeThumbColor: colors.white } as unknown as Partial<SwitchProps>)
      : null;

  return (
    <Switch
      trackColor={{ false: colors.surfaceBorder, true: activeTrackColor }}
      thumbColor={colors.white}
      {...webActiveThumb}
      {...rest}
    />
  );
}
