const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = 'src/features/discover/components/plaza-post-card.tsx';

test('PlazaPostCard wires delete to the API and discover store', () => {
  const src = read(SRC);

  assert.match(src, /deletePlazaPost/);
  assert.match(src, /storeRemovePlazaPost\s*=\s*useDiscoverStore/);
  assert.match(src, /await deletePlazaPost\(post\.id\)/);
  assert.match(src, /storeRemovePlazaPost\(post\.id\)/);
});

test('PlazaPostCard exposes delete only to the owner, now inside the actions menu', () => {
  const src = read(SRC);

  // 删除移入右上角「更多」菜单：仅 isOwnPost 分支加入该动作，仍绑定 handleDeletePost。
  assert.match(src, /if \(isOwnPost\)\s*\{[\s\S]*?onPress: handleDeletePost/);
  assert.match(src, /icon: 'trash-outline'/);
  // 右上角不再是独立删除按钮，而是打开菜单的「更多」(ellipsis) 按钮。
  assert.doesNotMatch(src, /onPress=\{handleDeletePost\}/);
  assert.match(src, /name="ellipsis-horizontal"/);
  assert.match(src, /setMenuVisible\(true\)/);
});

test('PlazaPostCard actions menu offers share to all and report to non-owners', () => {
  const src = read(SRC);

  // 分享 = 进好友选择页把帖子发到对话；举报走后端接口。
  assert.match(src, /pathname: '\/\(tabs\)\/discover\/share-post'/);
  assert.match(src, /reportPlazaPost\(post\.id\)/);
  assert.match(src, /key: 'share'/);
  assert.match(src, /key: 'report'/);
  // 举报在 else（非本人）分支。
  assert.match(src, /\} else \{[\s\S]*?onPress: handleReport/);
  // 动作菜单组件已挂载。
  assert.match(src, /<PlazaPostActionsSheet/);
});

test('PlazaPostCard signup button uses a person-add icon instead of a hand', () => {
  const src = read(SRC);

  // 已报名用实心对勾，未报名用实心 person-add（配合实心主色 CTA 按钮）。
  assert.match(src, /name=\{signed \? 'checkmark-circle' : 'person-add'\}/);
  assert.doesNotMatch(src, /hand-right-outline/);
});

test('PlazaPostCard accent bar color steps by time-to-expiry (day scale), not horn', () => {
  const src = read(SRC);

  // 「活动」身份：左侧强调竖条，配色随距到期剩余时间在天级阈值(1天/3天)逐级跳变。
  assert.match(src, /s\.accent/);
  assert.match(src, /getPostExpiryTier\(post\.expiresAt\)/);
  assert.match(src, /backgroundColor: accentColor/);
  // 三档分别映射到 warning(≤1天橙)/success(≤3天绿)/primary(更久紫)——不用红色。
  assert.match(src, /tier === 'urgent'\) return colors\.warning/);
  assert.match(src, /tier === 'soon'\) return colors\.success/);
  assert.doesNotMatch(src, /return colors\.error/);
  // 不再按喇叭帖决定强调色。
  assert.doesNotMatch(src, /post\.isHorn \? colors\.warning/);
});

test('PlazaPostCard uses a filled primary signup CTA', () => {
  const src = read(SRC);

  // 未报名 = 实心主色强 CTA（推动及时报名）。
  assert.match(src, /backgroundColor: colors\.primary/);
});

test('PlazaPostCard circle name tag uses squared corners instead of a pill', () => {
  const src = read(SRC);

  // 只锁「方角(Radius.sm) 而非胶囊(Radius.full)」这一意图，容忍块内新增的布局属性
  // （flexShrink/maxWidth —— 用于头部让位给用户名，避免短名被挤没）。
  assert.match(
    src,
    /tag:\s*\{[^}]*paddingHorizontal:\s*Spacing\.sm[^}]*borderRadius:\s*Radius\.sm[^}]*\}/,
  );
  assert.doesNotMatch(
    src,
    /tag:\s*\{[^}]*paddingHorizontal:\s*Spacing\.sm[^}]*borderRadius:\s*Radius\.full/,
  );
  assert.match(
    src,
    /tag:\s*\{\s*backgroundColor:\s*colors\.primary,\s*borderRadius:\s*Radius\.sm,\s*\}/,
  );
  assert.doesNotMatch(
    src,
    /tag:\s*\{\s*backgroundColor:\s*colors\.primary,\s*borderRadius:\s*Radius\.full,/,
  );
});

test('PlazaPostCard keeps the name readable and moves the circle tag to line 2', () => {
  const src = read(SRC);

  // 第一行只剩用户名 + 身份徽章：用户名最低收缩权重 + minWidth 兜底，短名不被挤没。
  assert.match(src, /nameShrink:\s*\{[^}]*flexShrink:\s*1[^}]*minWidth:\s*\d+[^}]*\}/);
  // 圈子标签下移到第二行（metaRow），与城市 · 时间同排。
  assert.match(
    src,
    /<View style=\{s\.metaRow\}>[\s\S]*?<View style=\{\[s\.tag, d\.tag\]\}>[\s\S]*?timeLabel/,
  );
  // 圈子标签在第二行只设 maxWidth 宽度上限（不再参与第一行的收缩竞争）。
  assert.match(src, /tag:\s*\{[^}]*maxWidth:\s*\d+[^}]*\}/);
  // 城市文本可收缩省略，避免把时间挤没。
  assert.match(src, /metaCity:\s*\{[^}]*flexShrink:\s*1[^}]*\}/);
  // 身份徽章最多展示 3 枚（+N 折叠其余）。
  assert.match(src, /<UserIconRow[\s\S]*?maxVisible=\{3\}/);
});

test('PlazaPostCard renders compact author display badges beside author info', () => {
  const src = read(SRC);

  assert.match(src, /import \{ UserIconRow \} from ['"]@\/components\/ui\/user-icon-row['"]/);
  assert.match(src, /authorDisplayIcons\s*=\s*post\.author\.displayIcons\s*\?\?\s*\[\]/);
  assert.match(src, /authorDisplayIcons\.length > 0/);
  assert.match(src, /<UserIconRow[\s\S]*?icons=\{authorDisplayIcons\}[\s\S]*?compact[\s\S]*?compactSize="small"/);
});
