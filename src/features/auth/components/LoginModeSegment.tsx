import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Radius, useTheme, withAlpha } from '@/theme';

export interface LoginModeOption<T extends string> {
  value: T;
  label: string;
  testID?: string;
}

interface LoginModeSegmentProps<T extends string> {
  options: readonly LoginModeOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  item: {
    flex: 1,
  },
  itemFill: {
    flex: 1,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 暗色下选中项底下的"光板"：比选中项四周宽 3px、下沉 2px，和登录键、航迹同一种光。
  glowPlate: {
    position: 'absolute',
    left: -3,
    right: -3,
    top: 2,
    bottom: -2,
    borderRadius: Radius.sm + 3,
  },
  label: {
    fontSize: 14,
  },
});

/**
 * 登录方式切换（密码 / 验证码 / 网页端扫码）。
 * 暗色是半透明"玻璃"容器 + 发光的选中项；亮色是白底描边容器，不发光。
 * memo：登录页每敲一个字都会重渲染，切换器的 props 在敲字时不变。
 */
export const LoginModeSegment = memo(function LoginModeSegment<T extends string>({
  options,
  value,
  onChange,
}: LoginModeSegmentProps<T>) {
  const { colors, resolvedMode } = useTheme();
  const dark = resolvedMode === 'dark';
  const containerStyle = dark
    ? {
        backgroundColor: withAlpha(colors.surface, 0.7),
        borderColor: withAlpha(colors.surfaceBorder, 0.6),
      }
    : { backgroundColor: colors.surface, borderColor: colors.surfaceBorder };

  return (
    <View style={[s.container, containerStyle]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={option.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={s.item}
          >
            {selected && dark ? (
              <View
                pointerEvents="none"
                style={[s.glowPlate, { backgroundColor: colors.primaryLight }]}
              />
            ) : null}
            <View
              style={[s.itemFill, selected && { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  s.label,
                  {
                    color: selected ? colors.white : colors.textSecondary,
                    // 暗色次要文字是纯白，未选中项只能靠字重区分。
                    fontWeight: selected || !dark ? '600' : '500',
                  },
                ]}
              >
                {option.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}) as <T extends string>(props: LoginModeSegmentProps<T>) => React.JSX.Element;
