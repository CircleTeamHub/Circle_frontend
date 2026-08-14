import { useCallback, useMemo } from 'react';
import {
  Linking,
  View,
  Text,
  StyleSheet,
  Pressable,
  type GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme, Spacing, Typography } from '@/theme';
import type { ChatMessage } from '@/types';
import {
  buildSystemMapUrls,
  getOpenStreetMapPreviewTiles,
  hasValidLocationCoordinates,
} from '@/features/location/utils/location-map';
import {
  CHAT_CARD_PADDING_VERTICAL,
  LOCATION_CARD_WIDTH,
  MessageAvatar,
} from './shared';

interface LocationCardProps {
  message: ChatMessage;
  outgoing?: boolean;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onAvatarPress?: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
}

const LOCATION_MAP_HEIGHT = 124;

const sLocation = StyleSheet.create({
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  rowOutgoing: {
    justifyContent: 'flex-end',
  },
  receivedAvatarSlot: {
    paddingBottom: 2,
  },
  locationCard: {
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
    width: LOCATION_CARD_WIDTH,
    overflow: 'hidden',
  },
  locationImage: {
    height: LOCATION_MAP_HEIGHT,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  locationImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationMapTile: {
    position: 'absolute',
    width: 256,
    height: 256,
  },
  locationMarker: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationMarkerDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attribution: {
    position: 'absolute',
    right: 4,
    bottom: 2,
    paddingHorizontal: 3,
    paddingVertical: 1,
    fontSize: 8,
  },
  locationCardBody: {
    maxWidth: LOCATION_CARD_WIDTH,
  },
  locationCardContent: {
    minHeight: 68,
    justifyContent: 'center',
  },
  locationInfo: {
    paddingVertical: CHAT_CARD_PADDING_VERTICAL,
    paddingHorizontal: 14,
  },
});

export const LocationCard: React.FC<LocationCardProps> = ({
  message,
  outgoing = false,
  // 同 ReceivedBubble：删除 '陈' 默认值。
  senderName = '',
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onAvatarPress,
  onLongPress,
}) => {
  const { colors } = useTheme();

  const d = useMemo(
    () => ({
      locationCard: {
        backgroundColor: colors.receivedBubble,
      },
      locationImageFallback: {
        backgroundColor: colors.surface,
      },
      locationMarkerDot: {
        backgroundColor: colors.primary,
      },
      attribution: {
        color: colors.textSecondary,
        backgroundColor: colors.overlay,
      },
      locationTitle: {
        color: colors.text,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      locationAddress: {
        color: colors.textSecondary,
        ...Typography.small,
        marginTop: 2,
      },
      timeText: {
        color: colors.textSecondary,
        ...Typography.tinyRegular,
        marginTop: Spacing.xs,
      },
    }),
    [colors],
  );

  const latitude = message.locationLatitude;
  const longitude = message.locationLongitude;
  const coordinates = useMemo(
    () =>
      hasValidLocationCoordinates(latitude, longitude)
        ? { latitude, longitude: longitude as number }
        : null,
    [latitude, longitude],
  );
  const hasCoordinates = coordinates !== null;
  const mapPreview = useMemo(
    () =>
      coordinates
        ? getOpenStreetMapPreviewTiles(
            coordinates.latitude,
            coordinates.longitude,
            LOCATION_CARD_WIDTH,
            LOCATION_MAP_HEIGHT,
            15,
          )
        : null,
    [coordinates],
  );
  const openLocationInMaps = useCallback(async () => {
    if (!coordinates) return;
    const urls = buildSystemMapUrls(
      coordinates.latitude,
      coordinates.longitude,
      message.locationTitle || message.locationAddress || '',
    );
    const primary = process.env.EXPO_OS === 'ios' ? urls.ios : urls.android;
    try {
      const supported = await Linking.canOpenURL(primary);
      await Linking.openURL(supported ? primary : urls.fallback);
    } catch {
      await Linking.openURL(urls.fallback).catch(() => undefined);
    }
  }, [coordinates, message.locationAddress, message.locationTitle]);

  const avatarNode = (
    <MessageAvatar
      message={message}
      outgoing={outgoing}
      selfName={selfName}
      selfAvatarUri={selfAvatarUri}
      senderName={senderName}
      senderAvatarUri={senderAvatarUri}
    />
  );

  const cardNode = (
    <View style={sLocation.locationCardBody}>
      <Pressable
        style={[sLocation.locationCard, d.locationCard]}
        onPress={hasCoordinates ? openLocationInMaps : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole={hasCoordinates ? 'link' : undefined}
        accessibilityLabel={message.locationTitle || message.locationAddress}
      >
        <View style={sLocation.locationImage}>
          {mapPreview ? (
            <>
              {mapPreview.tiles.map((tile) => (
                <Image
                  key={`${tile.url}:${tile.left}:${tile.top}`}
                  source={tile.url}
                  style={[
                    sLocation.locationMapTile,
                    { left: tile.left, top: tile.top },
                  ]}
                  contentFit="cover"
                  transition={150}
                />
              ))}
              <View pointerEvents="none" style={sLocation.locationMarker}>
                <View style={[sLocation.locationMarkerDot, d.locationMarkerDot]}>
                  <Ionicons name="location" size={22} color={colors.white} />
                </View>
              </View>
              <Text pointerEvents="none" style={[sLocation.attribution, d.attribution]}>
                © OpenStreetMap
              </Text>
            </>
          ) : (
            <View style={[sLocation.locationImageFallback, d.locationImageFallback]}>
              <Ionicons name="location" size={32} color={colors.textSecondary} />
            </View>
          )}
        </View>
        <View style={[sLocation.locationInfo, sLocation.locationCardContent]}>
          <Text style={d.locationTitle}>{message.locationTitle}</Text>
          <Text style={d.locationAddress}>{message.locationAddress}</Text>
        </View>
      </Pressable>
      {message.time ? <Text style={d.timeText}>{message.time}</Text> : null}
    </View>
  );

  if (outgoing) {
    return (
      <View style={[sLocation.receivedRow, sLocation.rowOutgoing]}>
        {cardNode}
        <View style={sLocation.receivedAvatarSlot}>{avatarNode}</View>
      </View>
    );
  }

  return (
    <View style={sLocation.receivedRow}>
      {onAvatarPress ? (
        <Pressable style={sLocation.receivedAvatarSlot} onPress={onAvatarPress}>
          {avatarNode}
        </Pressable>
      ) : (
        <View style={sLocation.receivedAvatarSlot}>{avatarNode}</View>
      )}
      {cardNode}
    </View>
  );
};
