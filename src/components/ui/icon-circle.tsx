import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

interface IconCircleProps {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  iconSize?: number;
  color?: string;
  bgColor: string;
}

export const IconCircle: React.FC<IconCircleProps> = ({
  name,
  size = 32,
  iconSize = 18,
  color,
  bgColor,
}) => {
  const { colors } = useTheme();
  const resolvedColor = color ?? colors.white;

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor },
      ]}
    >
      <Ionicons name={name} size={iconSize} color={resolvedColor} />
    </View>
  );
};

const styles = StyleSheet.create({
  circle: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
