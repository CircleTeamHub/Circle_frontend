import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Web 外壳（expo-router 静态 HTML 模板，dev 与 export 共用）。
 *
 * 核心职责：把**文档级滚动锁死**。App 是固定视口应用，滚动只应发生在
 * 内部 ScrollView/FlatList；而被 transform 移出屏外的元素（如浮动 tab 条
 * 隐藏时的 translateY(140)）会撑大 html 的可滚动区域，输入框聚焦等任何
 * 触发都能把整个文档滚下去 140px —— 表现为"页面顶部消失、滚轮滚不回来"。
 * html/body overflow hidden 后这类位移从根上不可能发生。
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="zh">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/* ScrollView 在 web 上正确滚动所需的基础样式重置（官方模板同款）。 */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: lockViewportCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const lockViewportCss = `
html, body, #root {
  height: 100%;
}
html {
  overflow: hidden;
  overscroll-behavior: none;
}
body {
  overflow: hidden;
}
`;
