import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import type { PickedLocation } from '@/features/location/types';
import { Spacing, Typography, useTheme } from '@/theme';
import {
  LEAFLET_1_9_4_CSS,
  LEAFLET_1_9_4_JS,
} from './leaflet-1.9.4';

type MapMessage =
  | ({ type: 'location-changed' } & PickedLocation)
  | { type: 'map-error'; message?: string }
  | { type: 'map-runtime-unavailable' };

type MapLocationPickerLabels = {
  title: string;
  searchPlaceholder: string;
  searchButton: string;
  confirmButton: string;
  selectedLabel: string;
  invalidTitle: string;
  invalidMessage: string;
  unavailableMessage: string;
  retryButton: string;
};

type MapLocationPickerScreenProps = {
  labels: MapLocationPickerLabels;
  onBack: () => void;
  onConfirm: (location: PickedLocation) => void;
};

const MAP_ORIGIN = 'https://appassets.invalid';
const MAX_LOCATION_TITLE_LENGTH = 120;
const MAX_LOCATION_ADDRESS_LENGTH = 500;

function readCoordinate(
  value: string | string[] | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serializeForInlineScript(value: string) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function normalizeCandidate(
  value: unknown,
  selectedLabel: string,
): PickedLocation | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<MapMessage> & Partial<PickedLocation>;
  if (candidate.type !== 'location-changed') return null;
  if (
    typeof candidate.latitude !== 'number' ||
    typeof candidate.longitude !== 'number' ||
    !Number.isFinite(candidate.latitude) ||
    !Number.isFinite(candidate.longitude) ||
    candidate.latitude < -90 ||
    candidate.latitude > 90 ||
    candidate.longitude < -180 ||
    candidate.longitude > 180
  ) {
    return null;
  }
  if (
    (candidate.title !== undefined && typeof candidate.title !== 'string') ||
    (candidate.address !== undefined && typeof candidate.address !== 'string')
  ) {
    return null;
  }

  // 超长截断,不整条判非法。updatePicked 现在每次改动都上报,把「地址太长」当成
  // 非法会在拖拽/反查途中弹一次告警,而且候选点停在上一处 —— 原生确认按钮提交的
  // 位置就和地图上的标记对不上了。长度上限本就只是防膨胀,截断已经够。
  const title = (candidate.title?.trim() ?? '').slice(
    0,
    MAX_LOCATION_TITLE_LENGTH,
  );
  const address = (candidate.address?.trim() ?? '').slice(
    0,
    MAX_LOCATION_ADDRESS_LENGTH,
  );

  return {
    title: title || selectedLabel,
    address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
  };
}

function buildMapHtml(
  { latitude, longitude, title, address }: PickedLocation,
  labels: Pick<
    MapLocationPickerLabels,
    'searchPlaceholder' | 'searchButton' | 'selectedLabel'
  >,
) {
  const safeTitle = escapeHtml(title);
  const safeAddress = escapeHtml(address);
  const safeSearchPlaceholder = escapeHtml(labels.searchPlaceholder);
  const safeSearchButton = escapeHtml(labels.searchButton);
  const safeSelectedLabel = escapeHtml(labels.selectedLabel);
  const scriptSelectedLabel = serializeForInlineScript(labels.selectedLabel);
  const scriptTitle = serializeForInlineScript(title || '');
  const scriptAddress = serializeForInlineScript(address || '');
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-circle-map'; style-src 'nonce-circle-map' 'unsafe-inline'; img-src https://tile.openstreetmap.org data: blob:; connect-src https://nominatim.openstreetmap.org">
  <style nonce="circle-map">${LEAFLET_1_9_4_CSS}</style>
  <style nonce="circle-map">
    html, body, #map { height: 100%; width: 100%; margin: 0; background: #111827; }
    .bottomSheet {
      position: fixed;
      left: 0;
      right: 0;
      bottom: calc(104px + env(safe-area-inset-bottom));
      z-index: 1000;
      display: grid;
      gap: 8px;
      padding: 12px;
      border-radius: 18px;
      background: rgba(17, 24, 39, .92);
      box-shadow: 0 -12px 28px rgba(0, 0, 0, .22);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .search { display: flex; gap: 8px; }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      border-radius: 8px;
      padding: 11px 12px;
      font-size: 15px;
      color: #111827;
      background: #fff;
    }
    button {
      min-height: 44px;
      border: 0;
      border-radius: 8px;
      padding: 0 14px;
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      background: #6366f1;
    }
    .picked {
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, .08);
      color: #fff;
      line-height: 1.4;
    }
    .picked small { display: block; color: #d1d5db; margin-top: 2px; }
    .circleMarker {
      width: 20px;
      height: 20px;
      border: 3px solid #fff;
      border-radius: 50%;
      background: #6366f1;
      box-shadow: 0 2px 8px rgba(0, 0, 0, .4);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="bottomSheet">
    <div class="search">
      <input id="query" maxlength="120" placeholder="${safeSearchPlaceholder}" value="${safeTitle || safeAddress}">
      <button id="search">${safeSearchButton}</button>
    </div>
    <div class="picked">
      <div id="picked-title">${safeTitle || safeSelectedLabel}</div>
      <small id="picked-address">${safeAddress}</small>
    </div>
  </div>
  <script nonce="circle-map">${LEAFLET_1_9_4_JS}</script>
  <script nonce="circle-map">
    const SELECTED_LABEL = ${scriptSelectedLabel};
    const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));

    try {
      if (typeof L === 'undefined') throw new Error('leaflet unavailable');

      const map = L.map('map', { zoomControl: false }).setView([${latitude}, ${longitude}], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const markerIcon = L.divIcon({
        className: '',
        html: '<div class="circleMarker"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      const marker = L.marker([${latitude}, ${longitude}], {
        draggable: true,
        icon: markerIcon
      }).addTo(map);
      let picked = {
        title: ${scriptTitle} || SELECTED_LABEL,
        address: ${scriptAddress},
        latitude: ${latitude},
        longitude: ${longitude}
      };

      function updatePicked(next) {
        picked = { ...picked, ...next };
        document.getElementById('picked-title').textContent = picked.title || SELECTED_LABEL;
        document.getElementById('picked-address').textContent = picked.address || '';
        marker.setLatLng([picked.latitude, picked.longitude]);
        post({ type: 'location-changed', ...picked });
      }

      let pickGeneration = 0;

      async function reverseGeocode(lat, lon) {
        pickGeneration += 1;
        const generation = pickGeneration;
        updatePicked({
          latitude: lat,
          longitude: lon,
          title: SELECTED_LABEL,
          address: lat.toFixed(5) + ', ' + lon.toFixed(5)
        });
        try {
          const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
          const response = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error('reverse request failed');
          const data = await response.json();
          if (generation !== pickGeneration) return;
          updatePicked({
            title: data.name || data.display_name?.split(',')[0] || SELECTED_LABEL,
            address: data.display_name || picked.address
          });
        } catch {
          post({ type: 'map-error', message: 'reverse failed' });
        }
      }

      async function searchPlace() {
        const query = document.getElementById('query').value.trim();
        if (!query) return;
        pickGeneration += 1;
        const generation = pickGeneration;
        try {
          const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(query);
          const response = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error('search request failed');
          const rows = await response.json();
          if (generation !== pickGeneration || !rows.length) return;
          const row = rows[0];
          const lat = Number(row.lat);
          const lon = Number(row.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          map.setView([lat, lon], 16);
          updatePicked({
            title: row.name || query,
            address: row.display_name || query,
            latitude: lat,
            longitude: lon
          });
        } catch {
          post({ type: 'map-error', message: 'search failed' });
        }
      }

      map.on('click', (event) => reverseGeocode(event.latlng.lat, event.latlng.lng));
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        reverseGeocode(pos.lat, pos.lng);
      });
      document.getElementById('search').addEventListener('click', searchPlace);
      document.getElementById('query').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') searchPlace();
      });
    } catch {
      post({ type: 'map-runtime-unavailable' });
    }
  </script>
</body>
</html>`;
}

export function MapLocationPickerScreen({
  labels,
  onBack,
  onConfirm,
}: MapLocationPickerScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    latitude?: string;
    longitude?: string;
    title?: string;
    address?: string;
  }>();
  const [loading, setLoading] = useState(true);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

  const initialLocation = useMemo<PickedLocation>(
    () => ({
      title:
        typeof params.title === 'string'
          ? params.title.slice(0, MAX_LOCATION_TITLE_LENGTH)
          : '',
      address:
        typeof params.address === 'string'
          ? params.address.slice(0, MAX_LOCATION_ADDRESS_LENGTH)
          : '',
      latitude: readCoordinate(params.latitude, 22.5431, -90, 90),
      longitude: readCoordinate(params.longitude, 114.0579, -180, 180),
    }),
    [params.address, params.latitude, params.longitude, params.title],
  );
  const [candidateLocation, setCandidateLocation] =
    useState<PickedLocation>(initialLocation);
  useEffect(() => setCandidateLocation(initialLocation), [initialLocation]);

  const mapHtml = useMemo(
    () => buildMapHtml(initialLocation, labels),
    [initialLocation, labels],
  );

  const handleRetry = useCallback(() => {
    setMapUnavailable(false);
    setLoading(true);
    setWebViewKey((key) => key + 1);
  }, []);

  const handleMapMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.nativeEvent.data) as unknown;
      } catch {
        return;
      }

      const message = payload as Partial<MapMessage>;
      if (message.type === 'map-error') return;
      if (message.type === 'map-runtime-unavailable') {
        setMapUnavailable(true);
        setLoading(false);
        return;
      }

      const candidate = normalizeCandidate(payload, labels.selectedLabel);
      if (!candidate) {
        Alert.alert(labels.invalidTitle, labels.invalidMessage);
        return;
      }
      setCandidateLocation(candidate);
    },
    [labels.invalidMessage, labels.invalidTitle, labels.selectedLabel],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(candidateLocation);
  }, [candidateLocation, onConfirm]);

  const handleNavigation = useCallback((request: WebViewNavigation) => {
    return (
      request.url === 'about:blank' || request.url.startsWith(`${MAP_ORIGIN}/`)
    );
  }, []);

  return (
    <View
      style={[
        s.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.title}
          onPress={onBack}
          hitSlop={8}
          style={s.backButton}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>{labels.title}</Text>
        <View style={s.headerSpacer} />
      </View>
      <View style={s.mapFrame}>
        {loading ? (
          <View style={[s.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        <WebView
          key={webViewKey}
          originWhitelist={[`${MAP_ORIGIN}/*`]}
          source={{ html: mapHtml, baseUrl: `${MAP_ORIGIN}/` }}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={handleNavigation}
          onLoadEnd={() => setLoading(false)}
          onMessage={handleMapMessage}
          style={s.webView}
        />
        <View
          style={[
            s.nativeConfirm,
            {
              backgroundColor: colors.background,
              paddingBottom: Math.max(insets.bottom, Spacing.md),
            },
          ]}
        >
          <View style={s.candidateCopy}>
            <Text
              numberOfLines={1}
              style={[s.candidateTitle, { color: colors.text }]}
            >
              {candidateLocation.title || labels.selectedLabel}
            </Text>
            <Text
              numberOfLines={1}
              style={[s.candidateAddress, { color: colors.textSecondary }]}
            >
              {candidateLocation.address}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.confirmButton}
            onPress={handleConfirm}
            style={[s.confirmButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[s.confirmText, { color: colors.white }]}>
              {labels.confirmButton}
            </Text>
          </Pressable>
        </View>
        {mapUnavailable ? (
          <View style={[s.unavailable, { backgroundColor: colors.background }]}>
            <Ionicons
              name="cloud-offline-outline"
              size={32}
              color={colors.textSecondary}
            />
            <Text style={[s.unavailableText, { color: colors.textSecondary }]}>
              {labels.unavailableMessage}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={handleRetry}
              style={[s.retryButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[s.retryText, { color: colors.white }]}>
                {labels.retryButton}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 52,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    ...Typography.h3,
    fontWeight: '700',
  },
  headerSpacer: { width: 44 },
  mapFrame: {
    flex: 1,
    margin: 0,
    overflow: 'hidden',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webView: { flex: 1 },
  nativeConfirm: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  candidateCopy: { flex: 1, minWidth: 0 },
  candidateTitle: { ...Typography.body, fontWeight: '600' },
  candidateAddress: { ...Typography.caption, marginTop: 2 },
  confirmButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: 999,
  },
  confirmText: { ...Typography.body, fontWeight: '700' },
  unavailable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  unavailableText: {
    ...Typography.body,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 999,
  },
  retryText: {
    ...Typography.body,
    fontWeight: '600',
  },
});
