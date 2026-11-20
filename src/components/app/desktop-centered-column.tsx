import { createContext, useContext, type PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTheme } from '@/theme';

export const WEB_COLUMN_MAX_WIDTH = 640;
const ContentColumnWidthContext = createContext<number | null>(null);

export function useContentColumnWidth(): number {
  const column = useContext(ContentColumnWidthContext);
  const { width } = useWindowDimensions();
  return column ?? width;
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%' },
});

function WebColumn({ children, maxWidth }: PropsWithChildren<{ maxWidth: number }>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  return (
    <ContentColumnWidthContext.Provider value={Math.min(width, maxWidth)}>
      <View style={[s.root, { backgroundColor: colors.surfaceMuted }]}>
        <View style={[s.column, { maxWidth, backgroundColor: colors.background }]}>
          {children}
        </View>
      </View>
    </ContentColumnWidthContext.Provider>
  );
}

export function DesktopCenteredColumn({
  children,
  maxWidth = WEB_COLUMN_MAX_WIDTH,
}: PropsWithChildren<{ maxWidth?: number }>) {
  // Keep the same navigator and form instances mounted as a browser window resizes.
  if (Platform.OS === 'web') return <WebColumn maxWidth={maxWidth}>{children}</WebColumn>;
  return <>{children}</>;
}
