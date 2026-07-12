# 启动动画 Lottie 素材

启动开场序列（`src/components/app/launch-reveal.tsx`）的「纸飞机折叠」这一段用 Lottie 播放。

## 放这里

把折叠动画的 Lottie JSON 命名为 **`plane-fold.json`** 放进本目录：

```
assets/lottie/plane-fold.json
```

放进去后，把 `launch-reveal.tsx` 顶部的 `HAS_FOLD_LOTTIE` 改为 `true`（或按注释解开 require），折叠段就会用真 Lottie 播放；否则用内置的风格化折叠占位。

## 从哪来（「你的紫色 logo 折成飞机」是定制动画，免费站没有现成的）

1. **LottieFiles（最快，需免费登录）**：搜 `paper plane`, `paper airplane fold`, `origami plane`，下载 **Lottie JSON**（不是 dotLottie/.lottie）。不是你的确切 logo，但是真折叠矢量动画，可在代码里 `colorFilters` 染成品牌紫 `#6366F1`。
2. **定制（保真最高）**：设计师用 After Effects + Bodymovin 插件，按你的 logo 做「扁平轮廓 → 折成飞机」，导出 JSON。
3. **Rive**：在 Rive 编辑器做，导出 `.riv`（需换 rive-react-native）或导出 Lottie。

## 规格建议

- 折叠时长约 1.2–1.6s（整段开场 < 6s）。
- 透明背景，主体居中。
- 收尾帧最好是「飞机成型、机头朝右上」，好和后面的起飞/绕屏无缝衔接。
