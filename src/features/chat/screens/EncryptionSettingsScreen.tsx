import { useChatStore } from '@/chat-core/store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Button, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { useTheme } from '@/theme';
import { getEncryptionClient, recoverMissingLocalKey } from '@/services/e2ee/client';
import { useAuthStore } from '@/stores/authStore';
import type { Directory, PublicDevice } from '@circle/e2ee/relay-client.mjs';

export default function EncryptionSettingsScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const epoch = useAuthStore(s => s.sessionEpoch);
  const [devices, setDevices] = useState<PublicDevice[]>([]);
  const [directory, setDirectory] = useState<Directory>();
  const [identity, setIdentity] = useState<{ deviceId: string; publicKey: string }>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [keyMissing, setKeyMissing] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [archiveCount, setArchiveCount] = useState<number>();
  const visibility = useRef(0);
  useEffect(() => {
    const tracker = visibility;
    setRecoveryCode(''); setEnteredCode('');
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { visibility.current++; setRecoveryCode(''); setEnteredCode(''); }
    });
    return () => { tracker.current++; subscription.remove(); };
  }, [epoch]);
  const refresh = useCallback(async () => {
    const client = await getEncryptionClient();
    const own = await client.devices();
    const remote = conversationId ? await client.directory(conversationId) : undefined;
    if (useAuthStore.getState().sessionEpoch !== epoch) return;
    setDevices(own); setDirectory(remote); setIdentity(client.device.publicIdentity());
    const store = useChatStore.getState();
    const conversation = store.conversations.find(c => c.id === conversationId);
    if (conversation && remote) store.upsertConversation({ ...conversation, textEncryption: remote.mode });
  }, [conversationId, epoch]);
  useEffect(() => { void refresh().catch((error: unknown) => { setStatus(t('e2ee.failed')); setKeyMissing((error as { code?: string })?.code === 'E2EE_LOCAL_KEY_MISSING'); }); }, [refresh, t]);
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setStatus('');
    try { await work(); await refresh(); if (useAuthStore.getState().sessionEpoch === epoch) setStatus(t('e2ee.done')); }
    catch { if (useAuthStore.getState().sessionEpoch === epoch) setStatus(t('e2ee.failed')); }
    finally { setBusy(false); }
  };
  const verify = (values: PublicDevice[], after?: () => Promise<unknown>) => Alert.alert(t('e2ee.verify'), t('e2ee.verifyHint'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('e2ee.verified'), onPress: () => void act(async () => { const c = await getEncryptionClient(); await c.run(() => c.trust(values)); await after?.(); }) },
  ]);
  return <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
    <NavHeader title={t('e2ee.title')} />
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 24 }}>
      <Text style={{ color: colors.text }}>{t('e2ee.disclosure')}</Text>
      <Text selectable style={{ color: colors.text }}>{identity?.deviceId}{'\n'}{identity?.publicKey}</Text>
      <Button disabled={busy} title={t('e2ee.register')} onPress={() => void act(async () => { const c = await getEncryptionClient(); return c.run(() => c.register(t('e2ee.deviceLabel'))); })} />
      <Text style={{ color: colors.text }}>{status}</Text>
      {keyMissing && <Button disabled={busy} title={t('e2ee.repairKey')} onPress={() => Alert.alert(t('e2ee.repairKey'), t('e2ee.repairKeyHint'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.confirm'), onPress: () => void act(async () => { await recoverMissingLocalKey(); setKeyMissing(false); }) }])} />}
      <Text style={{ color: colors.text }}>{t('e2ee.recoveryHint')}</Text>
      <Button disabled={busy} title={t('e2ee.createRecovery')} onPress={() => void act(async () => {
        const current = visibility.current;
        const c = await getEncryptionClient();
        const code = await c.run(() => c.createRecovery());
        if (current === visibility.current && useAuthStore.getState().sessionEpoch === epoch && AppState.currentState === 'active') setRecoveryCode(code);
      })} />
      {!!recoveryCode && <Text selectable style={{ color: colors.text }} accessibilityLabel={t('e2ee.recoveryCode')}>{recoveryCode}</Text>}
      <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" accessibilityLabel={t('e2ee.recoveryCode')} placeholder={t('e2ee.recoveryCode')} placeholderTextColor={colors.textSecondary} value={enteredCode} onChangeText={setEnteredCode} style={{ color: colors.text, borderWidth: 1, borderColor: colors.textSecondary, padding: 12 }} />
      <Button disabled={busy || !enteredCode.trim()} title={t('e2ee.recoverDevice')} onPress={() => void act(async () => {
        const code = enteredCode; setEnteredCode('');
        const c = await getEncryptionClient();
        await c.run(() => c.recover(code));
      })} />
      <Button disabled={busy} title={t('e2ee.backupHistory')} onPress={() => void act(async () => { const c = await getEncryptionClient(); setArchiveCount(await c.run(() => c.backupHistory())); })} />
      <Button disabled={busy} title={t('e2ee.restoreHistory')} onPress={() => void act(async () => { const c = await getEncryptionClient(); setArchiveCount(await c.run(() => c.restoreHistory())); })} />
      {archiveCount !== undefined && <Text style={{ color: colors.text }}>{t('e2ee.archiveCount', { count: archiveCount })}</Text>}
      {devices.map(device => <View key={device.id} style={{ gap: 8 }}>
        <Text selectable style={{ color: colors.text }}>{device.label} · {device.status}{'\n'}{device.id}{'\n'}{device.publicKey}</Text>
        {device.status === 'PENDING' && <Button disabled={busy} title={t('e2ee.approve')} onPress={() => verify([device], async () => { const c = await getEncryptionClient(); return c.run(() => c.deviceAction(device, 'approve')); })} />}
        {device.status !== 'REVOKED' && <Button disabled={busy} title={t('e2ee.revoke')} onPress={() => Alert.alert(t('e2ee.revoke'), t('e2ee.revokeHint'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('e2ee.revoke'), style: 'destructive', onPress: () => void act(async () => { const c = await getEncryptionClient(); return c.run(() => c.deviceAction(device, 'revoke')); }) }])} />}
      </View>)}
      {directory && <>
        <Text style={{ color: colors.text }}>{t('e2ee.conversation')} · {directory.mode}</Text>
        {directory.devices.map(device => <Text key={device.id} selectable style={{ color: colors.text }}>{device.purpose} · {device.label}{'\n'}{device.userID}{'\n'}{device.id}{'\n'}{device.publicKey}</Text>)}
        <Button disabled={busy} title={t('e2ee.verify')} onPress={() => verify(directory.devices)} />
        <Button disabled={busy} title={t(directory.room ? 'e2ee.updateMembers' : 'e2ee.enable')} onPress={() => void act(async () => { const c = await getEncryptionClient(); return c.run(() => directory.room ? c.reconcile(conversationId!) : c.enable(conversationId!)); })} />
        <Button disabled={busy} title={t('e2ee.sync')} onPress={() => void act(async () => { const c = await getEncryptionClient(); return c.run(() => c.sync(conversationId!)); })} />
      </>}
      <Button disabled={busy} title={t('e2ee.refresh')} onPress={() => void act(refresh)} />
    </ScrollView>
  </View>;
}
