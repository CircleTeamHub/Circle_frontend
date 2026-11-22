import { Platform, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';

// 网页上 expo-font 用 FontFaceObserver 等字体，12 秒没下完就 reject。@font-face 规则此时
// 已经注入、浏览器还在下载，原版 @expo/vector-icons 却在 componentDidMount 里不接这个
// reject：图标一直空白，还报一条未处理的 Promise 拒绝（Sentry REACT-NATIVE-DR）。
// 补丁见 patches/@expo+vector-icons+*.patch。
jest.mock('expo-font', () => ({
  isLoaded: jest.fn(() => false),
  loadAsync: jest.fn(() => Promise.reject(new Error('12000ms timeout exceeded'))),
}));

describe('@expo/vector-icons on a slow web font load', () => {
  it('still renders the glyph after the font loader times out', async () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      render(<Ionicons name="search" size={16} />);
      await act(async () => {});
      const glyph = String.fromCodePoint(Ionicons.glyphMap.search as number);
      const texts = screen.UNSAFE_getAllByType(Text);
      expect(texts.some((node) => [node.props.children].flat().includes(glyph))).toBe(true);
    } finally {
      restore.restore();
    }
  });
});
