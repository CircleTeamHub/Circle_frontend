# 会员头像框素材规格

- `diamond.png` — 钻石会员框（铂银冰晶环 + 银翼托蓝宝珠）
- `super.png` — 超级会员框（鎏金紫绸带环 + 金冠紫宝石 + 珍珠）
- 当前两张为 AI 插画稿（ChatGPT 生图，绿幕底）经管线处理产出。

## 替换/新增素材的契约

- 透明背景 PNG，正方形画布（当前 1024×1024，尺寸可变但必须正方形）。
- **中心圆形内孔（露出头像的区域）直径 = 画布边长 × 62.5%**（= 1 / 1.6）。
  前端按 `AVATAR_FRAME_SCALE = 1.6` 把框放大叠在头像上；装饰（皇冠/翅膀/晶簇）
  允许压在头像边缘上、也允许伸到环外，但必须留在画布内。
- 内孔比例改动必须三处同步：本文件、`scripts/normalize-avatar-frame.py` 的
  `HOLE_RATIO`、`src/features/profile/membership-frames.ts` 的 `AVATAR_FRAME_SCALE`。

## 素材处理管线（新图从这走）

1. 生成/获取框图：圆环居中，背景与中心镂空为**纯绿 #00FF00**（方便抠图）。
2. 抠绿幕：`python3 <scratchpad>/chroma_key.py in.png keyed.png`（绿优势度抠图+去绿边）。
   （脚本很短，丢了可按 scripts/ 内注释重写；核心是 alpha = 1-clip((g-max(r,b))/100)。）
3. 归一：`python3 scripts/normalize-avatar-frame.py keyed.png assets/frames/xxx.png`
   （稳健圆拟合自动找内孔，按契约缩放居中，输出 1024。）

## 渲染入口

- 档位映射：`src/features/profile/membership-frames.ts`（钻石/超级有框，其余无）。
- 叠加渲染：`src/components/ui/avatar.tsx`（仅圆形头像生效）与
  `UserProfileScreen` 的 hero 头像。
