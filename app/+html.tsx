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
/* 文字输入去掉浏览器默认的 focus outline：RNW 的 TextInput 渲染成
   <input>/<textarea>，聚焦时浏览器会在我们自绘的圆角边框里再套一圈亮环，
   深色模式下尤其扎眼。按钮/链接的焦点环保留，键盘导航看得见落点；
   这几类元素自己有光标（caret）指示焦点所在。

   为什么不留 :focus-visible —— 规范规定「接受键盘文本输入的元素」始终匹配
   :focus-visible，鼠标点击也算，所以那条路等于把亮环原样放回来。 */
input:focus,
input:focus-visible,
textarea:focus,
textarea:focus-visible,
[contenteditable]:focus,
[contenteditable]:focus-visible {
  outline: none;
  box-shadow: none;
}
/* select 是例外，必须留焦点指示：它没有光标，摘掉之后键盘用户 tab 进来
   完全看不出焦点落在哪一个下拉上。默认亮环换成跟随主题文本色的描边 ——
   既不是那圈扎眼的白框，也不会让人丢失落点。 */
select:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 1px;
}
html {
  overflow: hidden;
  overscroll-behavior: none;
}
body {
  overflow: hidden;
}
`;
