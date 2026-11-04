import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, BackHandler, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { ImageViewer } from '@/components/ui/image-viewer';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { NoteVideoViewer } from '@/features/notes/components/NoteVideoViewer';
import { CollectionContentPreview } from '@/features/profile/components/CollectionContentPreview';
import { getCollectionForwardItem, resolveCollectionContent, type CollectionContent } from '@/features/profile/collection-content';
import { getCollectedOpenIMMessagePayload } from '@/features/chat/utils/message-collection';
import { useMessageForwardStore } from '@/features/chat/store/use-message-forward-store';
import { getChatDetailHref, getUserProfileHref } from '@/features/user/utils/routes';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { deleteCollection, fetchCollections, type CollectionType, type UserCollection } from '@/services/api/collections';
import { useAuthStore } from '@/stores/authStore';
import { saveMediaToLibrary } from '@/utils/save-image';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';

type CollectionTab = 'ALL' | Exclude<CollectionType, 'NOTE'>;
const COLLECTION_TYPES: { id: CollectionTab; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'ALL', labelKey: 'profile.collections.tabs.all', icon: 'albums-outline' },
  { id: 'CHAT', labelKey: 'profile.collections.tabs.chat', icon: 'chatbubble-ellipses-outline' },
  { id: 'VIDEO', labelKey: 'profile.collections.tabs.video', icon: 'videocam-outline' },
  { id: 'VOICE', labelKey: 'profile.collections.tabs.voice', icon: 'mic-outline' },
  { id: 'MESSAGE', labelKey: 'profile.collections.tabs.message', icon: 'mail-outline' },
];
type CollectionRow = { item: UserCollection; content: CollectionContent };
type BatchProgress = { action: 'save' | 'delete'; current: number; total: number };

const s = StyleSheet.create({
  page: { flex: 1 },
  content: { width: '100%', maxWidth: 780, alignSelf: 'center', paddingHorizontal: Spacing.md, paddingBottom: Spacing.lg },
  header: { gap: Spacing.md, paddingVertical: Spacing.md },
  tabs: { gap: Spacing.sm, paddingRight: Spacing.sm },
  tab: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth },
  hint: { ...Typography.small },
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cardBody: { flex: 1, gap: Spacing.sm, minWidth: 0 },
  checkbox: { paddingTop: Spacing.xs },
  separator: { height: Spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  source: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1, minHeight: 28 },
  sourceText: { ...Typography.small, flexShrink: 1 },
  date: { ...Typography.tinyRegular },
  state: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.md },
  button: { minHeight: 44, paddingHorizontal: Spacing.md, justifyContent: 'center' },
  dock: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  dockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: Spacing.sm, paddingBottom: Spacing.sm },
  action: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, borderRadius: Radius.md },
  actionLabel: { ...Typography.caption },
  fullText: { ...Typography.bodyRegular, lineHeight: 25, padding: Spacing.lg },
});
function ItemSeparator() { return <View style={s.separator} />; }

export default function CollectionsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isOffline } = useNetworkStatus();
  const userID = useAuthStore(state => state.user?.id ?? null);
  const sessionEpoch = useAuthStore(state => state.sessionEpoch);
  const [activeType, setActiveType] = useState<CollectionTab>('ALL');
  const [items, setItems] = useState<UserCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const operationRef = useRef<symbol | null>(null);
  const mounted = useRef(true);
  const player = useAudioPlayer(null);
  const selectionMode = selectedIds !== null;
  const busy = progress !== null;
  const rows = useMemo(() => items.filter(item => item.userID === userID).map(item => ({ item, content: resolveCollectionContent(item, userID) })), [items, userID]);
  const selectedRows = useMemo(() => rows.filter(row => selectedIds?.has(row.item.id)), [rows, selectedIds]);
  const imageRows = useMemo(() => rows.filter(row => row.content.imageUri), [rows]);
  const imageIndex = imageRows.findIndex(row => row.item.id === imageId);
  const canSave = selectedRows.some(row => row.content.imageUri || row.content.videoUri);
  const forwardItems = selectedRows.map(row => getCollectionForwardItem(row.item, userID));
  const canForward = selectedRows.length > 0 && forwardItems.every(item => item !== null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setItems([]); setSelectedIds(null); setProgress(null); operationRef.current = null;
    setImageId(null); setVideoUri(null); setTextPreview(null); setVoiceId(null); player.pause();
  }, [sessionEpoch, player]);
  useEffect(() => {
    const listener = player.addListener('playbackStatusUpdate', status => setVoicePlaying(Boolean(status.playing) && !status.didJustFinish));
    return () => listener.remove();
  }, [player]);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!selectionMode) return false;
      if (!operationRef.current) setSelectedIds(null);
      return true;
    });
    return () => { back.remove(); player.pause(); };
  }, [player, selectionMode]));

  useEffect(() => {
    if (!userID) { setItems([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setLoadError(null); setStatusText(null);
    void fetchCollections(activeType === 'ALL' ? undefined : activeType).then(nextItems => {
      if (!cancelled) setItems(nextItems.filter(item => item.type !== 'NOTE'));
    }).catch(() => {
      if (!cancelled) setLoadError(t('profile.collections.loadError', { defaultValue: '收藏加载失败，请稍后重试' }));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeType, reloadKey, sessionEpoch, userID, t]);

  const toggle = useCallback((id: string, enter = false) => {
    if (operationRef.current) return;
    if (enter) player.pause();
    setSelectedIds(current => {
      const next = new Set(current ?? []);
      if (enter || !next.has(id)) next.add(id); else next.delete(id);
      return next;
    });
    setStatusText(null);
  }, [player]);

  async function runBatch(action: 'save' | 'delete', selected: CollectionRow[], epoch: number) {
    if (operationRef.current || useAuthStore.getState().sessionEpoch !== epoch) return;
    const pending = action === 'delete' ? selected : selected.filter(row => row.content.imageUri || row.content.videoUri);
    if (pending.length === 0) return;
    const token = Symbol(action);
    operationRef.current = token;
    const isCurrent = () => mounted.current && useAuthStore.getState().sessionEpoch === epoch && operationRef.current === token;
    const succeeded = new Set<string>();
    let denied = false;
    setProgress({ action, current: 0, total: pending.length }); setStatusText(null); player.pause();
    try {
      const chunkSize = action === 'save' ? 1 : 3;
      for (let offset = 0; offset < pending.length && isCurrent() && !denied; offset += chunkSize) {
        await Promise.all(pending.slice(offset, offset + chunkSize).map(async ({ item, content }) => {
          try {
            if (action === 'delete') await deleteCollection(item.id);
            else {
              const result = await saveMediaToLibrary((content.imageUri || content.videoUri)!, { mimeType: content.videoUri ? 'video/mp4' : 'image/jpeg' });
              if (result === 'denied') denied = true;
              if (result !== 'saved') return;
            }
            succeeded.add(item.id);
          } catch { /* Keep failed entries selected for retry. */ }
        }));
        if (isCurrent()) setProgress({ action, current: Math.min(offset + chunkSize, pending.length), total: pending.length });
      }
      if (!isCurrent()) return;
      if (action === 'delete') setItems(current => current.filter(item => !succeeded.has(item.id)));
      const remaining = new Set(selected.filter(row => !succeeded.has(row.item.id)).map(row => row.item.id));
      setSelectedIds(remaining.size ? remaining : null);
      setStatusText(denied
        ? t('profile.collections.saveDenied', { defaultValue: '请允许访问相册后重试' })
        : action === 'save'
          ? t('profile.collections.batchSaveResult', { succeeded: succeeded.size, failed: pending.length - succeeded.size, skipped: selected.length - pending.length, defaultValue: '已保存 {{succeeded}} 项，{{failed}} 项失败，{{skipped}} 项不支持保存' })
          : t('profile.collections.batchDeleteResult', { succeeded: succeeded.size, failed: pending.length - succeeded.size, defaultValue: '已删除 {{succeeded}} 项，{{failed}} 项失败' }));
    } finally {
      if (isCurrent()) setProgress(null);
      if (operationRef.current === token) operationRef.current = null;
    }
  }

  function requestDelete() {
    if (!selectedRows.length || operationRef.current) return;
    const epoch = sessionEpoch;
    const selected = selectedRows;
    Alert.alert(t('profile.collections.deleteTitle', { defaultValue: '确认删除' }),
      t('profile.collections.batchDeleteConfirm', { count: selected.length, defaultValue: '确定删除选中的 {{count}} 项收藏吗？' }), [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        { text: t('common.delete', { defaultValue: '删除' }), style: 'destructive', onPress: () => runBatch('delete', selected, epoch) },
      ]);
  }
  function forwardSelected() {
    if (!canForward || operationRef.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
    useMessageForwardStore.getState().setPendingBatch(forwardItems.filter(item => item !== null));
    player.pause(); setSelectedIds(null);
    router.push({ pathname: '/(tabs)/messages/forward-picker' });
  }
  async function openContent({ item, content }: CollectionRow) {
    if (useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
    if (selectionMode) { toggle(item.id); return; }
    if (content.imageUri) { player.pause(); setImageId(item.id); return; }
    if (content.videoUri) { player.pause(); setVideoUri(content.videoUri); return; }
    if (content.kind === 'voice' && content.voiceUri) {
      try {
        await setAudioModeAsync({ playsInSilentMode: true });
        if (!mounted.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
        if (voiceId === item.id && player.playing) player.pause();
        else { if (voiceId !== item.id) player.replace(content.voiceUri); setVoiceId(item.id); player.play(); }
      } catch { setStatusText(t('profile.collections.unavailable', { defaultValue: '内容暂不可用' })); }
      return;
    }
    const friend = content.message?.friendCard;
    if (friend) { router.navigate(getUserProfileHref('profile', friend.userID, friend.nickname)); return; }
    if (content.text && content.kind === 'text') { setTextPreview(content.text); return; }
    setStatusText(t('profile.collections.unavailable', { defaultValue: '内容暂不可用' }));
  }

  const renderItem = ({ item: row }: { item: CollectionRow }) => {
    const { item, content } = row;
    const payload = getCollectedOpenIMMessagePayload(item.payload);
    const conversationID = typeof payload?.conversationID === 'string' ? payload.conversationID : undefined;
    const sourceID = typeof payload?.sourceID === 'string' ? payload.sourceID : conversationID?.startsWith('sg_') ? conversationID.slice(3) : null;
    const conversationType = payload?.conversationType === 'private' ? 'private' : payload?.conversationType === 'group' || conversationID?.startsWith('sg_') ? 'group' : undefined;
    const conversationTitle = typeof payload?.conversationTitle === 'string' ? payload.conversationTitle : '';
    const date = new Date(item.createdAt);
    const timestamp = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(i18n.language, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const selected = Boolean(selectedIds?.has(item.id));
    return (
      <Pressable testID={'collection-item-' + item.id} accessibilityRole={selectionMode ? 'checkbox' : 'button'} accessibilityLabel={item.title}
        accessibilityState={selectionMode ? { checked: selected, disabled: busy } : undefined} disabled={busy} delayLongPress={300}
        onPress={() => void openContent(row)} onLongPress={() => toggle(item.id, true)}
        style={({ pressed }) => [s.card, { backgroundColor: selected ? withAlpha(colors.primary, 0.08) : colors.surface, borderColor: selected ? colors.primary : colors.surfaceBorder, opacity: pressed ? 0.75 : 1 }]}>
        {selectionMode ? <View style={s.checkbox}><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? colors.primary : colors.textSecondary} /></View> : null}
        <View style={s.cardBody}>
          <CollectionContentPreview content={content} playing={voiceId === item.id && voicePlaying} />
          <View style={s.meta}>
            {sourceID && conversationType && !selectionMode ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('profile.collections.backToMessages', { defaultValue: '回到消息' })} style={s.source}
                onLongPress={() => toggle(item.id, true)}
                onPress={() => router.push(getChatDetailHref('profile', sourceID, conversationTitle, undefined, conversationID, payload?.messageID, conversationType))}>
                <Ionicons name="return-down-forward" size={13} color={colors.textSecondary} />
                <Text style={[s.sourceText, { color: colors.textSecondary }]} numberOfLines={1}>{t('profile.collections.fromSource', { title: conversationTitle, defaultValue: '来自 {{title}}' })}</Text>
              </Pressable>
            ) : conversationTitle ? <Text style={[s.sourceText, { color: colors.textSecondary }]} numberOfLines={1}>{conversationTitle}</Text> : null}
            <Text style={[s.date, { color: colors.textSecondary }]}>{timestamp}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  const header = <View style={s.header}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
      {COLLECTION_TYPES.map(type => <Pressable key={type.id} accessibilityRole="button" accessibilityState={{ selected: activeType === type.id, disabled: busy }} disabled={busy}
        onPress={() => { if (activeType !== type.id) setItems([]); setActiveType(type.id); setSelectedIds(null); setImageId(null); setVideoUri(null); setTextPreview(null); player.pause(); }}
        style={[s.tab, { borderColor: colors.surfaceBorder, backgroundColor: colors.surface }, activeType === type.id && { borderColor: colors.primary, backgroundColor: colors.primary }]}>
        <Ionicons name={type.icon} size={15} color={activeType === type.id ? colors.white : colors.textSecondary} />
        <Text style={{ ...Typography.caption, color: activeType === type.id ? colors.white : colors.textSecondary }}>{t(type.labelKey)}</Text>
      </Pressable>)}
    </ScrollView>
    {!selectionMode && items.length > 0 ? <Text style={[s.hint, { color: colors.textSecondary }]}>{t('profile.collections.longPressHint', { defaultValue: '长按收藏可多选编辑' })}</Text> : null}
    {isOffline ? <Text style={[s.hint, { color: colors.textSecondary }]}>{t('network.offlineBanner', { defaultValue: '当前无网络连接，部分功能可能不可用' })}</Text> : null}
    {statusText ? <Text accessibilityLiveRegion="polite" style={[s.hint, { color: colors.textSecondary }]}>{statusText}</Text> : null}
    {loadError && items.length > 0 ? <Text style={[s.hint, { color: colors.textSecondary }]}>{loadError}</Text> : null}
  </View>;

  return (
    <View style={[s.page, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <NavHeader title={t('profile.collections.menuLabel', { defaultValue: '我的收藏' })} onBackPress={selectionMode ? () => { if (!busy) setSelectedIds(null); } : undefined}
        rightSlot={selectionMode ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={s.button} onPress={() => setSelectedIds(null)}><Text style={{ color: colors.primary }}>{t('common.cancel', { defaultValue: '取消' })}</Text></Pressable> : undefined} />
      <FlatList data={rows} keyExtractor={row => row.item.id} renderItem={renderItem} extraData={selectedIds} contentContainerStyle={s.content}
        ListHeaderComponent={header} ItemSeparatorComponent={ItemSeparator} refreshing={loading && items.length > 0}
        onRefresh={busy ? undefined : () => { setSelectedIds(null); setReloadKey(key => key + 1); }}
        ListEmptyComponent={<View style={s.state}>
          {loading ? <ActivityIndicator color={colors.primary} /> : loadError ? <>
            <Text style={{ color: colors.textSecondary }}>{loadError}</Text>
            <Pressable accessibilityRole="button" style={s.button} onPress={() => setReloadKey(key => key + 1)}><Text style={{ color: colors.primary }}>{t('common.retry', { defaultValue: '重试' })}</Text></Pressable>
          </> : <>
            <Ionicons name="bookmark-outline" size={36} color={colors.primary} />
            <Text style={{ ...Typography.h3, color: colors.text }}>{t('profile.collections.empty', { defaultValue: '还没有收藏' })}</Text>
            <Text style={{ ...Typography.caption, color: colors.textSecondary }}>{t('profile.collections.emptyHint', { defaultValue: '在聊天里长按消息，选择「收藏」' })}</Text>
          </>}
        </View>} />
      {selectionMode ? <View style={[s.dock, { backgroundColor: colors.surface, borderColor: colors.surfaceBorder, paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
        <View style={s.dockHeader}>
          <Text accessibilityLiveRegion="polite" style={{ ...Typography.caption, color: colors.text }}>{progress
            ? t('profile.collections.operationProgress', { current: progress.current, total: progress.total, defaultValue: '正在处理 {{current}}/{{total}}' })
            : t('profile.collections.selectedCount', { count: selectedRows.length, defaultValue: '已选 {{count}} 项' })}</Text>
          <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={() => setSelectedIds(selectedRows.length === rows.length ? new Set() : new Set(rows.map(row => row.item.id)))}>
            <Text style={{ color: colors.primary }}>{selectedRows.length === rows.length && rows.length > 0 ? t('profile.collections.deselectAll', { defaultValue: '取消全选' }) : t('profile.collections.selectAll', { defaultValue: '全选' })}</Text>
          </Pressable>
        </View>
        {!canForward && selectedRows.length > 0 ? <Text style={[s.hint, { color: colors.textSecondary }]}>{t('profile.collections.unsupportedForward', { defaultValue: '选中内容暂不支持转发' })}</Text> : null}
        <View style={s.actions}>
          {([
            { label: t('common.save', { defaultValue: '保存' }), icon: 'download-outline', enabled: canSave, onPress: () => void runBatch('save', selectedRows, sessionEpoch), tint: colors.primary },
            { label: t('chat.messageActions.forward', { defaultValue: '转发' }), icon: 'arrow-redo-outline', enabled: canForward, onPress: forwardSelected, tint: colors.primary },
            { label: t('common.delete', { defaultValue: '删除' }), icon: 'trash-outline', enabled: selectedRows.length > 0, onPress: requestDelete, tint: colors.danger },
          ] as const).map(action => <Pressable key={action.icon} accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={{ disabled: busy || !action.enabled }}
            disabled={busy || !action.enabled} onPress={action.onPress} style={[s.action, { opacity: busy || !action.enabled ? 0.4 : 1, backgroundColor: withAlpha(action.tint, 0.07) }]}>
            <Ionicons name={action.icon} size={23} color={action.tint} /><Text style={[s.actionLabel, { color: action.tint }]}>{action.label}</Text>
          </Pressable>)}
        </View>
      </View> : null}
      {imageId && imageIndex >= 0 ? <ImageViewer visible images={imageRows.map(row => row.content.imageUri!)} initialIndex={imageIndex} onClose={() => setImageId(null)} /> : null}
      {videoUri ? <NoteVideoViewer uri={videoUri} onClose={() => setVideoUri(null)} /> : null}
      <BottomSheetModal visible={textPreview !== null} onClose={() => setTextPreview(null)} sheetStyle={{ backgroundColor: colors.surface, maxHeight: '80%' }}>
        <View style={s.dockHeader}>
          <Text style={[s.fullText, { color: colors.text }]}>{t('profile.collections.textPreviewTitle', { defaultValue: '收藏内容' })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close', { defaultValue: '关闭' })} style={s.button} onPress={() => setTextPreview(null)}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
        </View>
        <ScrollView><Text selectable style={[s.fullText, { color: colors.text }]}>{textPreview}</Text></ScrollView>
      </BottomSheetModal>
    </View>
  );
}
