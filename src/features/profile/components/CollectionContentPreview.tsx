import { Ionicons } from '@expo/vector-icons';
import { MediaImage } from '@/components/ui/media-image';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import type { CollectionContent } from '../collection-content';

interface CollectionContentPreviewProps {
  content: CollectionContent;
  playing?: boolean;
  expanded?: boolean;
}

const s = StyleSheet.create({
  container: { width: '100%', minWidth: 0, gap: Spacing.sm },
  body: { ...Typography.bodyRegular, fontSize: 17, lineHeight: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  textColumn: { flex: 1, minWidth: 0, gap: Spacing.xs },
  title: { ...Typography.body, lineHeight: 21 },
  secondary: { ...Typography.caption, lineHeight: 19 },
  media: {
    width: 60, height: 60, flexShrink: 0,
    borderRadius: 2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  play: {
    width: 30, height: 30, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  duration: {
    position: 'absolute', bottom: Spacing.sm, right: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
  },
  voice: {
    alignSelf: 'flex-start', width: '100%', maxWidth: 300,
    padding: Spacing.md, borderRadius: Radius.md,
  },
  voiceIcon: {
    width: 40, height: 40, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  locationIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  unavailable: { paddingVertical: Spacing.sm },
});

/** Content only: the collection row owns gestures, playback and navigation. */
export function CollectionContentPreview({ content, playing = false, expanded = false }: CollectionContentPreviewProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [failedUri, setFailedUri] = useState<string>();
  const imageUri = content.kind === 'image' ? content.posterUri || content.imageUri : content.posterUri;
  const currentImageUri = useRef(imageUri);
  currentImageUri.current = imageUri;
  const duration = content.duration === undefined
    ? undefined
    : `${Math.floor(content.duration / 60)}:${Math.floor(content.duration % 60).toString().padStart(2, '0')}`;
  const unavailable = (
    <View style={[s.row, s.unavailable]}>
      <Ionicons name="alert-circle-outline" size={22} color={colors.textSecondary} />
      <Text style={[s.secondary, { color: colors.textSecondary, flexShrink: 1 }]}>
        {t('profile.collections.unavailable', { defaultValue: 'Content unavailable' })}
      </Text>
    </View>
  );
  let preview;

  if ((content.kind === 'image' && imageUri && imageUri !== failedUri)
    || (content.kind === 'video' && content.videoUri)) {
    const isVideo = content.kind === 'video';
    preview = (
      <View
        testID="collection-preview-media"
        accessibilityLabel={isVideo
          ? t('profile.collections.videoPreviewLabel', { defaultValue: 'Saved video' })
          : t('profile.collections.imagePreviewLabel', { defaultValue: 'Saved photo' })}
        style={[s.media, expanded && { width: 200, height: 128, borderRadius: 0, alignSelf: 'center' }, { backgroundColor: isVideo ? colors.black : expanded ? 'transparent' : colors.surface }]}
      >
        {imageUri && imageUri !== failedUri ? (
          <MediaImage
            key={imageUri}
            testID="collection-preview-image"
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit={expanded ? 'contain' : 'cover'}
            enforceEarlyResizing
            recyclingKey={imageUri}
            onError={() => {
              if (currentImageUri.current === imageUri) setFailedUri(imageUri);
            }}
          />
        ) : null}
        {isVideo ? (
          <>
            <View testID="collection-preview-play" style={[s.play, { backgroundColor: withAlpha(colors.black, 0.6) }]}>
              <Ionicons name="play" size={25} color={colors.white} />
            </View>
            {duration !== undefined ? (
              <View style={[s.duration, { backgroundColor: withAlpha(colors.black, 0.7) }]}>
                <Text style={[Typography.small, { color: colors.white }]}>{duration}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    );
  } else if (content.kind === 'text' && content.text) {
    preview = <Text style={[s.body, { color: colors.text }]} numberOfLines={3}>{content.text}</Text>;
  } else if (content.kind === 'voice' && content.voiceUri) {
    preview = (
      <View style={[s.row, s.voice, { backgroundColor: withAlpha(colors.primary, 0.08) }]}>
        <View style={[s.voiceIcon, { backgroundColor: withAlpha(colors.primary, 0.12) }]}>
          <Ionicons name={playing ? 'pause' : 'play'} size={20} color={colors.primary} />
        </View>
        <View style={s.textColumn}>
          <Text style={[s.title, { color: colors.text }]}>
            {t('profile.collections.voicePreviewLabel', { defaultValue: 'Voice message' })}
          </Text>
          {playing ? (
            <Text style={[s.secondary, { color: colors.primary }]}>
              {t('profile.collections.voicePlayingLabel', { defaultValue: 'Playing' })}
            </Text>
          ) : null}
        </View>
        {duration !== undefined ? <Text style={[s.secondary, { color: colors.textSecondary }]}>{duration}</Text> : null}
      </View>
    );
  } else if (content.kind === 'friend-card' && content.message?.friendCard) {
    const card = content.message.friendCard;
    preview = (
      <View style={s.row}>
        <Avatar size={48} shape="square" name={card.nickname} uri={card.faceURL || undefined} />
        <View style={s.textColumn}>
          <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>{card.nickname}</Text>
          {card.persona ? <Text style={[s.secondary, { color: colors.textSecondary }]} numberOfLines={2}>{card.persona}</Text> : null}
          <Text style={[Typography.small, { color: colors.textSecondary }]}>
            {t('chat.friendCard.label', { defaultValue: 'Contact card' })}
          </Text>
        </View>
      </View>
    );
  } else if (content.kind === 'location' && (content.message?.locationTitle || content.message?.locationAddress)) {
    const title = content.message.locationTitle || content.message.locationAddress;
    const address = content.message.locationAddress;
    preview = (
      <View style={s.row}>
        <View style={[s.locationIcon, { backgroundColor: withAlpha(colors.primary, 0.1) }]}>
          <Ionicons name="location-outline" size={24} color={colors.primary} />
        </View>
        <View style={s.textColumn}>
          <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>{title}</Text>
          {address && address !== title ? <Text style={[s.secondary, { color: colors.textSecondary }]} numberOfLines={2}>{address}</Text> : null}
          <Text style={[Typography.small, { color: colors.textSecondary }]}>
            {t('chat.attachments.location', { defaultValue: 'Location' })}
          </Text>
        </View>
      </View>
    );
  } else if (content.kind === 'transfer-card' && (content.message?.transferCard || content.text)) {
    const receipt = content.message?.transferCard;
    preview = (
      <View style={s.textColumn}>
        <Text style={[s.title, { color: colors.text }]}>{t('chat.transfer.title')}</Text>
        <Text style={[s.body, { color: colors.text }]}>{receipt ? `${receipt.amount.toLocaleString()} ${t('common.coin')}` : content.text}</Text>
        {receipt?.message ? <Text style={[s.secondary, { color: colors.textSecondary }]} numberOfLines={3}>{receipt.message}</Text> : null}
      </View>
    );
  } else {
    preview = unavailable;
  }

  return <View testID="collection-content-preview" pointerEvents="none" style={s.container}>{preview}</View>;
}
