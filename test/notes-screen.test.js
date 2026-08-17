/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
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

test('NotesScreen has 已下架 entry button', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /已下架/);
});

test('NotesScreen opens a standalone unlisted notes page instead of filtering inline', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  // trash-outline 曾被禁止:那会儿删除只活在回收站流程里。现在列表有正当的
  // 删除入口(动作菜单软删 + 多选批量删,都进回收站),不再断言它不存在。
  assert.doesNotMatch(src, /deletedNotes/);
  assert.doesNotMatch(src, /showUnlisted/);
  assert.doesNotMatch(src, /status: showUnlisted \? 'UNLISTED' : 'ACTIVE'/);
  assert.match(src, /fetchNotes\(\{ status: 'ACTIVE' \}\)/);
  assert.match(src, /\/\(tabs\)\/profile\/notes\/unlisted/);
  assert.doesNotMatch(src, /notes\.unlistedAutoDeleteHint/);
});

test('UnlistedNotesScreen lists only unlisted notes and can relist them', () => {
  const screen = read('src/features/notes/screens/UnlistedNotesScreen.tsx');
  const route = read('app/(tabs)/profile/notes/unlisted.tsx');
  const zh = read('src/i18n/locales/zh.json');

  assert.match(route, /UnlistedNotesScreen/);
  assert.match(screen, /fetchNotes\(\{ status: 'UNLISTED' \}\)/);
  assert.match(screen, /relistNote/);
  assert.match(screen, /notes\.actions\.relist/);
  assert.match(screen, /cloud-upload-outline/);
  assert.match(screen, /notes\.unlistedAutoDeleteHint/);
  assert.match(screen, /notes\.empty\.noUnlisted/);
  // 语义拍板（2026-08-16）：下架是长期仓库不再自动删除；到期清理只发生在回收站。
  assert.match(zh, /已下架笔记不会自动删除，可随时重新上架。/);
  assert.doesNotMatch(zh, /已下架笔记会在一个月后自动删除/);
  assert.match(zh, /上架/);
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
  // 单条笔记分享改为「弹会话选择器发给好友/群聊」：不再生成网页分享链接。
  assert.match(src, /handleShareNote\b/);
  assert.match(src, /<ShareNoteSheet/);
  assert.match(src, /buildNoteCardPayloadFromSummary/);
  assert.doesNotMatch(src, /createNoteShareLink/);
});

test('NotesScreen no longer exposes the old top-right settings page', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  assert.doesNotMatch(src, /settings-outline/);
  assert.doesNotMatch(src, /\/\(tabs\)\/profile\/notes\/settings/);
  assert.doesNotMatch(src, /useNotesSettingsStore/);
  assert.equal(
    fs.existsSync(
      path.join(ROOT, 'src/features/notes/screens/NotesSettingsScreen.tsx'),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(ROOT, 'src/features/notes/store/use-notes-settings-store.ts'),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'app/(tabs)/profile/notes/settings.tsx')),
    false,
  );
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
  // 多选模式加入后卡片 onPress 先走 handleCardPress 分流：选择态勾选、常态进详情。
  assert.match(src, /params: \{ id: note\.id, ownerId: currentUserId \?\? '' \}/);
  assert.match(src, /onPress=\{handleCardPress\}/);
  assert.match(src, /openNote\(note\);/);
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

test('GroupManagerSheet reloads memberships after a partial save failure', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /let shouldReloadAfterFailure = false/);
  assert.match(src, /shouldReloadAfterFailure = true/);
  assert.match(src, /if \(shouldReloadAfterFailure\) \{\s*await onMembershipsChanged\(\);/);
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

test('GroupManagerSheet is a full-screen page without backdrop chrome', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');

  // 已从底部弹层升级为全屏页：无遮罩/backdrop，安全区内自带标题栏与关闭按钮。
  assert.match(src, /animationType="slide"/);
  assert.doesNotMatch(src, /transparent/);
  assert.doesNotMatch(src, /modalBackdrop/);
  assert.doesNotMatch(src, /modalOverlay/);
  assert.match(src, /screen:\s*{[\s\S]*?flex:\s*1/);
  assert.match(src, /insets\.top/);
  assert.match(src, /name="close"/);
});

test('GroupManagerSheet lets fixed tabs (all/ungrouped) join drag reordering', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');
  const zh = read('src/i18n/locales/zh.json');

  // 固定 tab 与分组同列表拖动：整条顺序本地持久化，分组相对顺序才写服务端。
  assert.match(src, /mergeTabOrder/);
  assert.match(src, /NOTES_TAB_ALL/);
  assert.match(src, /setTabOrderIds\(finalRows\.map\(\(row\) => row\.id\)\)/);
  assert.match(src, /groupOrderChanged/);
  // 固定 tab 行不渲染 成员/改名/删除 动作（group 为空时整块隐藏）。
  assert.match(src, /\{group \? \(\s*<View style=\{s\.groupRowActions\}>/);
  // NotesScreen 的 tab 顺序同样经 mergeTabOrder 还原。
  assert.match(screen, /mergeTabOrder/);
  assert.match(screen, /useNotesTabOrderStore/);
  assert.match(zh, /全部和未分组也可拖动排序，但不能改名或删除。/);
  assert.match(zh, /输入分组名添加新的分组/);
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

test('GroupManagerSheet uses stable drag responders directly on each row handle', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /dragRespondersRef/);
  assert.match(src, /getDragResponder/);
  assert.match(src, /currentRows\.findIndex/);
  assert.match(src, /getDragResponder\(row\.id\)\.panHandlers/);
  assert.doesNotMatch(src, /pendingDragRef/);
});

test('GroupManagerSheet prevents ScrollView from stealing row drag gestures', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /scrollEnabled=\{!draggingRowId\}/);
  assert.match(src, /onMoveShouldSetPanResponderCapture:\s*\(\) => true/);
  assert.match(src, /onShouldBlockNativeResponder:\s*\(\) => true/);
});

test('GroupManagerSheet resets drag offset synchronously when releasing a group', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');
  assert.match(src, /dragY\.stopAnimation\(\)/);
  assert.match(src, /dragY\.setValue\(0\)/);
  assert.doesNotMatch(src, /Animated\.spring\(dragY/);
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

  // 菜单承载置顶/多选/备注/编辑/分组/分享/删除/下架；删除是软删进回收站
  // (30 天可恢复),用 notes.actions.delete 专属文案,不复用 common.delete。
  assert.match(screen, /<NoteActionsSheet/);
  assert.match(screen, /onMorePress=\{openMenu\}/);
  assert.match(screen, /unlistNote/);
  assert.match(screen, /handleUnlistNote/);
  assert.match(sheet, /notes\.actions\.pin/);
  assert.match(sheet, /notes\.actions\.edit/);
  assert.match(sheet, /notes\.actions\.share/);
  assert.match(sheet, /notes\.actions\.unlist/);
  assert.match(sheet, /archive-outline/);
  assert.match(sheet, /notes\.actions\.delete/);
  assert.match(sheet, /trash-outline/);
  assert.match(sheet, /onDelete/);
  assert.doesNotMatch(sheet, /common\.delete/);
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

  // 来源卡片整块从正文移除：来源与下载都收进右下角悬浮列，
  // 原来的浅底卡片与 primaryDeep CTA 胶囊一并删除。
  assert.doesNotMatch(detail, /sourceCard/);
  assert.doesNotMatch(detail, /sourceBtn:/);
  // 悬浮钮用不透明 surface 底 + 细边，压在图片上也不透字。
  assert.match(detail, /floatingBtn: \{\s*backgroundColor: colors\.surface/);

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

  // 分享按钮在下载按钮左边，点开弹会话选择器发给好友/群聊（非网页链接/系统面板）。
  assert.match(src, /handleShareNote/);
  assert.match(src, /<ShareNoteSheet/);
  assert.match(src, /buildNoteCardPayloadFromSummary/);
  assert.doesNotMatch(src, /createNoteShareLink/);
  const shareIdx = src.indexOf("name=\"share-outline\"");
  const downloadIdx = src.indexOf("name=\"download-outline\"");
  assert.ok(shareIdx > 0 && downloadIdx > 0, 'both header icons exist');
  assert.ok(shareIdx < downloadIdx, 'share sits before download');
});

test('GroupManagerSheet name input is a visible shadowed pill', () => {
  const src = read('src/features/notes/components/GroupManagerSheet.tsx');

  // 可见边框 + 阴影 + 胶囊圆角；全屏页底是 background，输入底翻成 surface 立出来。
  assert.match(src, /modalInput:\s*\{[\s\S]*?borderColor:\s*colors\.surfaceBorder/);
  assert.match(src, /modalInput:\s*\{[\s\S]*?backgroundColor:\s*colors\.surface/);
  assert.match(src, /modalInput:\s*\{[\s\S]*?borderRadius:\s*Radius\.full[\s\S]*?shadowOpacity/);
});

test('ShareNoteSheet sends the note as a card to a chosen friend/group', () => {
  const sheet = read('src/features/notes/components/ShareNoteSheet.tsx');

  // 契约随自研栈迁移更新(意图不变):会话选择器列出 chat-core 会话,
  // 点选把笔记以 note-card 发进所选会话。
  assert.match(sheet, /loadChatConversations/);
  assert.match(sheet, /sendCardMessage/);
  assert.match(sheet, /type: 'note-card'/);
  assert.match(sheet, /BottomSheetModal/);
  assert.match(sheet, /notes\.shareToChat\.title/);
});

test('ShareNoteSheet maps send failures to stable user-facing copy', () => {
  const sheet = read('src/features/notes/components/ShareNoteSheet.tsx');
  assert.match(sheet, /getShareNoteSendErrorMessage/);
  assert.match(sheet, /notes\.shareToChat\.failedMessage/);
  assert.doesNotMatch(sheet, /error instanceof Error\s*\?\s*error\.message/);
});
