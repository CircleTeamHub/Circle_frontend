/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('NotesScreen renders 我的笔记 title', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /我的笔记/);
});

test('NotesScreen has search input placeholder', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /输入你想搜索的内容/);
});

test('NotesScreen has 新建 button', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /新建/);
});

test('NotesScreen has 已下架 filter button', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /已下架/);
});

test('NotesScreen bottom bar keeps only the 新建 button', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  // 底栏只留「新建」；整表分享 + 二维码入口移除（分享改走单条：卡片⋯菜单 + 详情页头部）。
  assert.match(src, /notes\.actions\.new/);
  assert.doesNotMatch(src, /notes\.actions\.qrCode/);
  assert.doesNotMatch(src, /qr-code-outline/);
  // 整表分享/二维码相关逻辑已清理干净。
  assert.doesNotMatch(src, /handleShareNotes\b/);
  assert.doesNotMatch(src, /buildShareInput/);
  assert.doesNotMatch(src, /ensureShareLink/);
  assert.doesNotMatch(src, /openQrSheet/);
  assert.doesNotMatch(src, /NoteShareQrSheet/);
  assert.doesNotMatch(src, /qrVisible/);
  // 单条笔记分享仍在（菜单里的「分享」）。
  assert.match(src, /handleShareNote\b/);
  assert.match(src, /createNoteShareLink/);
});

test('NotesScreen fetches notes and groups', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /fetchNotes/);
  assert.match(src, /fetchNoteGroups/);
});

test('NotesScreen passes the current user as owner when opening note details', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(src, /useAuthStore/);
  assert.match(src, /currentUserId/);
  assert.match(src, /pathname: '\/\(tabs\)\/profile\/notes\/\[id\]'/);
  // NoteCard 已 memo，跳转回调改为稳定 useCallback（携带 note 参数）。
  assert.match(src, /params: \{ id: note\.id, ownerId: currentUserId \?\? '' \}/);
  assert.match(src, /onPress=\{openNote\}/);
});

test('NotesScreen refreshes notes and groups when returning from note edits', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /useFocusEffect/);
  assert.match(src, /void load\(\)/);
  // 失败时除了停 spinner 还要标记错误态（列表区提供重试入口），不再静默吞掉。
  assert.match(
    src,
    /if \(mountedRef\.current\) \{\s*setLoadError\(true\);\s*setLoading\(false\);/,
  );
  assert.match(src, /notes\.loadFailed/);
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*let cancelled = false;[\s\S]*load\(\)\.catch/);
});

test('NotesScreen supports pull-to-refresh for notes and groups', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(src, /const \[refreshing, setRefreshing\] = useState\(false\)/);
  assert.match(src, /handleRefreshNotes/);
  assert.match(src, /const mountedRef = useRef\(true\)/);
  assert.match(src, /mountedRef\.current = false/);
  assert.match(src, /refreshInFlightRef/);
  assert.match(src, /if \(refreshInFlightRef\.current\) return;/);
  assert.match(src, /setRefreshing\(true\)/);
  assert.match(src, /await load\(\)/);
  assert.match(src, /if \(!mountedRef\.current\) return;/);
  assert.match(src, /if \(mountedRef\.current\) setRefreshing\(false\)/);
  assert.match(src, /refreshing=\{refreshing\}/);
  assert.match(src, /onRefresh=\{handleRefreshNotes\}/);
});

test('NotesScreen supports group management and multi-group filtering', () => {
  // 拆分后 NotesScreen 只保留列表 + tab 视图；group CRUD + drag/reorder + Animated.Value
  // 全部下沉到 GroupManagerSheet.tsx（review #60）。
  const screenSrc = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(screenSrc, /管理|ellipsis-horizontal/);
  assert.match(screenSrc, /note\.groups|n\.groups/);
  assert.match(screenSrc, /groups\.length === 0/);
  assert.match(screenSrc, /GroupManagerSheet/);

  const sheetSrc = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(sheetSrc, /createNoteGroup/);
  assert.match(sheetSrc, /updateNoteGroup/);
  assert.match(sheetSrc, /deleteNoteGroup/);
  assert.match(sheetSrc, /reorderNoteGroups/);
  assert.match(sheetSrc, /PanResponder/);
  assert.match(sheetSrc, /Animated\.Value|new Animated\.Value/);
});

test('GroupManagerSheet lets a group directly choose which notes belong to it', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /editingMembershipGroup/);
  assert.match(src, /openGroupMembershipEditor/);
  assert.match(src, /toggleMembershipNote/);
  assert.match(src, /handleSaveGroupMemberships/);
  assert.match(src, /选择笔记/);
  assert.match(src, /保存选择/);
  // review #59: 不再 fetchNoteDetail，直接调 PATCH /note/:id/groups（updateNoteGroupIds）。
  assert.match(src, /updateNoteGroupIds/);
  assert.doesNotMatch(src, /fetchNoteDetail/);
});

test('GroupManagerSheet optimizes group note assignment for larger note lists', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /membershipSearch/);
  assert.match(src, /filteredMembershipNotes/);
  assert.match(src, /renderMembershipNote/);
  assert.match(src, /membershipList/);
  assert.match(src, /搜索笔记/);
  assert.match(src, /runWithConcurrencyLimit/);
  assert.match(src, /MEMBERSHIP_SAVE_CONCURRENCY/);
  assert.match(src, /keyExtractor=\{\(item\) => item\.id\}/);
});

test('NotesScreen keeps group management action fixed beside the scrollable tabs', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /<View style=\{s\.tabsRow\}>/);
  assert.match(src, /style=\{s\.tabsScroll\}/);
  assert.match(src, /<Pressable style=\{s\.manageTab\} onPress=\{\(\) => setManagerVisible\(true\)\}>/);
  assert.match(src, /tabsScroll:\s*{[^}]*flex:\s*1/);
  assert.match(src, /manageTab:\s*{[^}]*width:\s*40/);

  const scrollStart = src.indexOf('<ScrollView');
  const scrollEnd = src.indexOf('</ScrollView>', scrollStart);
  const manageButton = src.indexOf('<Pressable style={s.manageTab}', scrollStart);
  assert.ok(scrollStart >= 0 && scrollEnd > scrollStart);
  assert.ok(manageButton > scrollEnd);
});

test('GroupManagerSheet keeps group management sheet interactions inside a non-pressable card', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /<View style=\{\[s\.modalCard, d\.modalCard\]\}>/);
  assert.doesNotMatch(src, /<Pressable style=\{\[s\.modalCard, d\.modalCard\]\}/);
});

test('GroupManagerSheet keeps the group manager backdrop behind the editor controls', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /<View style=\{\[s\.modalOverlay, d\.modalOverlay\]\} pointerEvents="box-none">/);
  assert.match(src, /modalBackdrop:\s*{[\s\S]*zIndex:\s*0/);
  assert.match(src, /modalCard:\s*{[\s\S]*zIndex:\s*1/);
  assert.match(src, /modalCard:\s*{[\s\S]*elevation:\s*1/);
});

test('GroupManagerSheet keeps the add group button pressable and focuses the input for empty names', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /groupNameInputRef/);
  assert.match(src, /handleSubmitGroupPress/);
  assert.match(src, /onPress=\{handleSubmitGroupPress\}/);
  assert.match(src, /disabled=\{savingGroup\}/);
  assert.doesNotMatch(src, /disabled=\{savingGroup \|\| !draftGroupName\.trim\(\)\}/);
});

test('GroupManagerSheet limits custom note groups to ten', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');

  assert.match(src, /MAX_NOTE_GROUPS\s*=\s*10/);
  assert.match(src, /isCreatingGroupAtLimit/);
  assert.match(src, /groups\.length\s*>=\s*MAX_NOTE_GROUPS/);
  assert.match(src, /notes\.alerts\.groupLimitTitle/);
  assert.match(src, /notes\.alerts\.groupLimitMessage/);

  const submitBlock = src.slice(
    src.indexOf('const handleSubmitGroupPress'),
    src.indexOf('const openGroupMembershipEditor'),
  );
  assert.ok(submitBlock.includes('isCreatingGroupAtLimit'));
  assert.ok(submitBlock.indexOf('isCreatingGroupAtLimit') < submitBlock.indexOf('void handleSaveGroup()'));

  const saveBlock = src.slice(
    src.indexOf('const handleSaveGroup'),
    src.indexOf('const handleSubmitGroupPress'),
  );
  assert.ok(saveBlock.includes('createNoteGroup'));
  assert.ok(saveBlock.indexOf('isCreatingGroupAtLimit') < saveBlock.indexOf('createNoteGroup'));
});

test('GroupManagerSheet uses stable drag responders directly on each custom group handle', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /dragRespondersRef/);
  assert.match(src, /getDragResponder/);
  assert.match(src, /groupsRef\.current\.findIndex/);
  assert.match(src, /getDragResponder\(group\.id\)\.panHandlers/);
  assert.doesNotMatch(src, /pendingDragRef/);
  assert.doesNotMatch(src, /createDragResponder\(group\.id, index\)\.panHandlers/);
});

test('GroupManagerSheet prevents ScrollView from stealing group drag gestures', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /scrollEnabled=\{!draggingGroupId\}/);
  assert.match(src, /onMoveShouldSetPanResponderCapture:\s*\(\) => true/);
  assert.match(src, /onShouldBlockNativeResponder:\s*\(\) => true/);
});

test('EditNoteScreen loads and submits multiple group ids', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');
  assert.match(src, /fetchNoteGroups/);
  assert.match(src, /selectedGroupIds|groupIds/);
  assert.match(src, /groupIds:/);
});

test('EditNoteScreen does not render selected groups a second time', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.doesNotMatch(src, /selectedGroups/);
  assert.doesNotMatch(src, /selectedGroupTag/);
  assert.doesNotMatch(src, /selectedGroupText/);
  assert.doesNotMatch(src, /notes\.edit\.noGroups/);
});

test('EditNoteScreen lays out note metadata as compact wrapping rows', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /groupLabelRow/);
  assert.match(src, /folder-open-outline/);
  assert.match(src, /groupChipsWrap/);
  assert.match(src, /flexWrap:\s*'wrap'/);
  assert.match(src, /paddingVertical:\s*5/);
});

test('EditNoteScreen leaves breathing room around title date and groups', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /titleInput:\s*\{[\s\S]*paddingBottom:\s*Spacing\.sm/);
  assert.match(src, /metaRow:\s*\{[\s\S]*paddingBottom:\s*Spacing\.sm/);
  assert.match(src, /groupSection:\s*\{[\s\S]*paddingTop:\s*Spacing\.sm/);
  assert.match(src, /groupSection:\s*\{[\s\S]*gap:\s*Spacing\.sm/);
});

test('EditNoteScreen group chips are square (matching the detail tags)', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  // 锁定 StyleSheet 里的 groupChip 块（以 borderWidth:1 起头，区别于 d memo 里只有
  // 颜色的同名键）；[^}] 截到第一个右括号，别串到后面别的样式。
  const block = src.match(/groupChip:\s*\{\s*borderWidth:\s*1,[^}]*\}/);
  assert.ok(block, 'groupChip style block not found');
  // 方形：圆角来自 Radius token（Radius.xs），不用胶囊也不用魔法数。
  assert.match(block[0], /borderRadius:\s*Radius\.xs/);
  assert.doesNotMatch(block[0], /Radius\.full/);
  assert.doesNotMatch(block[0], /borderRadius:\s*\d/);
});

test('EditNoteScreen selected group chips use the note brand purple', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  // 选中态用笔记品牌紫 brandPurple（与详情页分组标签同一支），不再是靛蓝 primary。
  assert.match(
    src,
    /groupChipActive:\s*\{\s*backgroundColor:\s*colors\.brandPurple,\s*borderColor:\s*colors\.brandPurple/,
  );
  assert.match(src, /groupChipTextActive:\s*\{\s*color:\s*colors\.white\s*\}/);
});

test('EditNoteScreen renders four large structured note edit regions', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /ScrollView/);
  assert.match(src, /renderSectionHeader/);
  assert.match(src, /sectionBlock/);
  assert.match(src, /notes\.edit\.sections\.text/);
  assert.match(src, /notes\.edit\.sections\.media/);
  assert.match(src, /notes\.edit\.sections\.showcase/);
  assert.match(src, /notes\.edit\.sections\.location/);
  assert.doesNotMatch(src, /editSections/);
  assert.doesNotMatch(src, /sectionGrid/);
});

test('EditNoteScreen adds content directly inside media showcase and location sections', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /mediaItems/);
  assert.match(src, /showcaseItems/);
  assert.match(src, /handleAddSectionMedia/);
  assert.match(src, /renderAddButton\(\s*'media'/);
  assert.match(src, /renderAddButton\(\s*'showcase'/);
  assert.match(src, /renderMediaList/);
  assert.match(src, /mediaToolbarEnabled=\{false\}/);
  assert.match(src, /locationDraft/);
  assert.match(src, /locationTitlePlaceholder/);
  assert.match(src, /locationAddressPlaceholder/);
  assert.match(src, /const nextLocation =/);
  assert.match(src, /location: nextLocation/);
});

test('EditNoteScreen can select a real map location and save coordinates', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /useNoteLocationPickerStore/);
  assert.match(src, /useFocusEffect/);
  assert.match(src, /handleOpenLocationPicker/);
  assert.match(src, /handleUseCurrentLocation/);
  assert.match(src, /latitude: locationDraft\.latitude/);
  assert.match(src, /longitude: locationDraft\.longitude/);
  assert.match(src, /notes\/location-picker/);
});

test('EditNoteScreen presents structured regions with quieter section chrome', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  // 分区从贯穿全宽的分隔线改为安静的卡片（surface 底 + 细边 + 大圆角），
  // 小节头收敛成 眉标 + 右侧计数文本，不再有计数胶囊和解释性副标题。
  assert.match(src, /sectionShell/);
  assert.match(src, /sectionHeaderMeta/);
  assert.match(
    src,
    /sectionBlock:\s*\{[\s\S]*?borderRadius:\s*Radius\.lg/,
  );
  assert.doesNotMatch(src, /sectionCountPill/);
  assert.match(src, /const renderSectionHeader = \([\s\S]*meta\?: string/);
  assert.match(src, /flexDirection:\s*'row'/);
});

test('EditNoteScreen renders media as a stable preview grid', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /expo-image/);
  assert.match(src, /mediaPreviewGrid/);
  assert.match(src, /mediaPreviewTile/);
  assert.match(src, /mediaThumb/);
  assert.match(src, /mediaRemoveButton/);
  assert.match(src, /contentFit="cover"/);
});

test('EditNoteScreen shows a real map preview for selected locations', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /buildMapPreviewUrl/);
  assert.match(src, /staticmap\.openstreetmap\.de/);
  assert.match(src, /locationPreviewCard/);
  assert.match(src, /locationMapPreview/);
  assert.match(src, /locationCoordinatePill/);
});

test('NoteCard renders title and meta', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');
  assert.match(src, /note\.title/);
  assert.match(src, /buildNoteMeta/);
});

test('NoteCard exposes a single more-actions button (not per-action buttons)', () => {
  const card = read('src/features/notes/components/NoteCard.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');
  const sheet = read('src/features/notes/components/NoteActionsSheet.tsx');

  // 卡片上两个按钮（置顶/编辑）收敛成一个「⋯」，打开动作菜单。
  assert.match(card, /onMorePress\?: \(note: NoteSummary\) => void/);
  assert.match(card, /ellipsis-horizontal/);
  assert.doesNotMatch(card, /onPinPress/);
  assert.doesNotMatch(card, /onEditPress/);

  // 菜单承载置顶/编辑/分享/删除四个动作。
  assert.match(screen, /<NoteActionsSheet/);
  assert.match(screen, /onMorePress=\{openMenu\}/);
  assert.match(sheet, /notes\.actions\.pin/);
  assert.match(sheet, /notes\.actions\.edit/);
  assert.match(sheet, /notes\.actions\.share/);
  assert.match(sheet, /common\.delete/);
  assert.match(sheet, /trash-outline/);
});

test('ProfileScreen navigates to notes on menu item press', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.match(src, /profile\/notes/);
  assert.match(src, /handleMenuPress/);
});

test('ProfileScreen does not include the assistant menu item', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.doesNotMatch(src, /profile\.assistant/);
});

test('NoteDetailScreen follows the divider + icon-chip section design', () => {
  const detail = read('src/features/notes/screens/NoteDetailScreen.tsx');
  const renderer = read('src/features/notes/components/NoteBlockRenderer.tsx');

  // 设计稿：小节之间用 1pt 分隔线（发丝线真机太淡）+ 主色浅底图标章头分段；
  // 正文是主角，不加章头直接展开。
  assert.match(detail, /divider:\s*\{\s*height:\s*1,/);
  assert.match(detail, /sectionIconChip/);
  assert.match(detail, /renderSectionHeader\(\s*'image-outline'/);
  // 文字区也有自己的 heading（text-outline）—— 所有区域结构一致。
  assert.match(detail, /renderSectionHeader\(\s*'text-outline'/);
  assert.doesNotMatch(detail, /sectionCard:/);

  // 来源名片：主色浅底 + 深一档实心靛蓝"查看原消息"胶囊（primaryDeep token）。
  assert.match(detail, /sourceCard: \{ backgroundColor: colors\.primaryLight \}/);
  assert.match(detail, /sourceBtn: \{ backgroundColor: colors\.primaryDeep \}/);

  // 分组标签：方形品牌紫实心块 + 白字（brandPurple = 会员卡渐变核心 #7C5CF0）。
  assert.match(detail, /groupTag: \{ backgroundColor: colors\.brandPurple \}/);
  assert.match(detail, /groupTagText: \{ color: colors\.white \}/);
  assert.match(detail, /groupTag:\s*\{[\s\S]*?borderRadius:\s*Radius\.xs/);
  const colorsSrc = read('src/theme/colors.ts');
  assert.match(colorsSrc, /brandPurple: '#7C5CF0'/);

  // 媒体满宽圆角，按真实宽高比渲染（比例夹在 3:4 与 16:9 之间），
  // 无尺寸信息回退方图。
  assert.match(renderer, /resolveMediaAspectRatio/);
  assert.match(renderer, /Math\.min\(16 \/ 9, Math\.max\(3 \/ 4, width \/ height\)\)/);
  assert.match(renderer, /mediaFrame:\s*\{\s*borderRadius:\s*Radius\.lg,\s*overflow:\s*'hidden'/);

  // 文字区始终展示（heading + 分割线与各区域一致）；hasTextBody 只决定
  // 展示正文还是「暂无文字」占位。不再用 extractPlainText 二次嗅探
  // （它不递归嵌套 children，会把缩进列表等真实正文误判为空而整段藏掉）。
  assert.match(detail, /const hasTextBody = Boolean\(availability\?\.hasText\)/);
  assert.match(detail, /notes\.section\.emptyText/);
  assert.doesNotMatch(detail, /textSectionHasContent/);
  assert.doesNotMatch(detail, /extractPlainText\(/);
  assert.doesNotMatch(detail, /import \{ extractPlainText \}/);
});

test('NoteDetailScreen header adds a share button left of download', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');

  // 分享按钮在下载按钮左边，走单条分享链接 + 系统分享面板。
  assert.match(src, /handleShareNote/);
  assert.match(src, /createNoteShareLink/);
  const shareIdx = src.indexOf("name=\"share-outline\"");
  const downloadIdx = src.indexOf("name=\"download-outline\"");
  assert.ok(shareIdx > 0 && downloadIdx > 0, 'both header icons exist');
  assert.ok(shareIdx < downloadIdx, 'share sits before download');
});

test('GroupManagerSheet name input is a visible shadowed pill', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');

  // 之前边框用 surface（隐形）；现在可见边框 + background 凹槽底 + 阴影 + 胶囊圆角。
  assert.match(src, /modalInput:\s*\{[\s\S]*?borderColor:\s*colors\.surfaceBorder/);
  assert.match(src, /modalInput:\s*\{[\s\S]*?backgroundColor:\s*colors\.background/);
  assert.match(src, /modalInput:\s*\{[\s\S]*?borderRadius:\s*Radius\.full[\s\S]*?shadowOpacity/);
});
