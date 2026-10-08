import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { fetchAdvertisements, isAdvertisementActive, isPublicHttpsUrl, type Advertisement } from '@/services/api/advertisements';

export function CampaignAdBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [result, setResult] = useState<{ epoch: number; ads: Advertisement[] } | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    let pending = false;
    setResult(null);
    if (!isAuthenticated) return;
    const isCurrent = () => active && useAuthStore.getState().sessionEpoch === sessionEpoch;
    const refresh = async () => {
      if (pending || AppState.currentState !== 'active') return;
      pending = true;
      try {
        const ads = await fetchAdvertisements();
        if (isCurrent()) setResult({ epoch: sessionEpoch, ads });
      } catch {
        // Keep the last successful ads on transient failures; the expiry timer
        // and focus/session cleanup still remove stale results.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 60_000);
    const expiry = setInterval(() => {
      if (isCurrent()) setResult((current) => {
        if (!current) return null;
        const ads = current.ads.filter((ad) => isAdvertisementActive(ad));
        return ads.length === current.ads.length ? current : { ...current, ads };
      });
    }, 1_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
      }
    });
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(expiry);
      subscription.remove();
      setResult(null);
    };
  }, [isAuthenticated, sessionEpoch]));

  const openAd = async (ad: Advertisement) => {
    if (!isPublicHttpsUrl(ad.targetUrl) || !isAdvertisementActive(ad) ||
        useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
    try {
      await Linking.openURL(ad.targetUrl);
    } catch {
      Alert.alert(t('common.error'), t('discover.adLinkFailed'));
    }
  };

  const ads = result?.epoch === sessionEpoch ? result.ads.filter((ad) => isAdvertisementActive(ad)) : [];
  if (!ads.length || !isAuthenticated) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {ads.map((ad) => (
        <Pressable key={ad.id} style={[styles.card, { backgroundColor: colors.surface }]}
          accessibilityRole="link" accessibilityLabel={t('discover.adOpen', { title: ad.title })}
          onPress={() => { void openAd(ad); }}>
          <Image source={{ uri: ad.imageUrl }} style={styles.image} resizeMode="cover" />
          <View style={styles.caption}>
            <Text style={{ color: colors.textSecondary, ...Typography.caption }}>{t('discover.adLabel')}</Text>
            <Text numberOfLines={2} style={{ color: colors.text, ...Typography.body }}>{ad.title}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: Spacing.md, gap: Spacing.sm },
  card: { width: 260, borderRadius: 16, overflow: 'hidden' },
  image: { width: 260, height: 130 },
  caption: { padding: Spacing.sm, gap: 4 },
});
