import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { PickedLocation } from '@/features/location/types';
import { Spacing, Typography, useTheme } from '@/theme';

type MapMessage =
  | ({ type: 'location-selected' } & PickedLocation)
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

function readNumber(value: string | string[] | undefined, fallback: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function buildMapHtml(
  { latitude, longitude, title, address }: PickedLocation,
  labels: Pick<
    MapLocationPickerLabels,
    'searchPlaceholder' | 'searchButton' | 'confirmButton' | 'selectedLabel'
  >,
) {
  const safeTitle = escapeHtml(title);
  const safeAddress = escapeHtml(address);
  const safeSearchPlaceholder = escapeHtml(labels.searchPlaceholder);
  const safeSearchButton = escapeHtml(labels.searchButton);
  const safeConfirmButton = escapeHtml(labels.confirmButton);
  const safeSelectedLabel = escapeHtml(labels.selectedLabel);
  const scriptSelectedLabel = serializeForInlineScript(labels.selectedLabel);
  const scriptTitle = serializeForInlineScript(title || '');
  const scriptAddress = serializeForInlineScript(address || '');
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; background: #111827; }
    .bottomSheet {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      display: grid;
      gap: 8px;
      padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
      border-radius: 18px 18px 0 0;
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
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="bottomSheet">
    <div class="search">
      <input id="query" placeholder="${safeSearchPlaceholder}" value="${safeTitle || safeAddress}">
      <button id="search">${safeSearchButton}</button>
    </div>
    <div class="picked">
      <div id="picked-title">${safeTitle || safeSelectedLabel}</div>
      <small id="picked-address">${safeAddress}</small>
    </div>
    <button id="confirm">${safeConfirmButton}</button>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const SELECTED_LABEL = ${scriptSelectedLabel};
    const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    // CDN 拿不到 leaflet 时 L 是 undefined，下面第一行就抛，确认按钮的监听根本
    // 没注册上——而 onLoadEnd 已经把转圈收掉了，用户看到的是一个"能点但没反应"
    // 的界面。这里显式上报，让原生侧给出可重试的失败态。
    if (typeof L === 'undefined') {
      post({ type: 'map-runtime-unavailable' });
    } else {
    const map = L.map('map', { zoomControl: false }).setView([${latitude}, ${longitude}], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const marker = L.marker([${latitude}, ${longitude}], { draggable: true }).addTo(map);
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
    }

    // 每次"用户改变了选点"都推进一代。慢的那次响应回来时若已经不是最新一代，
    // 就丢弃——否则先点 A 后点 B、A 的地址后到，B 的坐标会配上 A 的地址；搜索
    // 结果更狠，会把整个选点挪回旧位置。
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
      } catch (error) {
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
        if (generation !== pickGeneration) return;
        if (!rows.length) return;
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
      } catch (error) {
        post({ type: 'map-error', message: 'search failed' });
      }
    }

    map.on('click', (event) => {
      reverseGeocode(event.latlng.lat, event.latlng.lng);
    });
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      reverseGeocode(pos.lat, pos.lng);
    });
    document.getElementById('search').addEventListener('click', searchPlace);
    document.getElementById('query').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchPlace();
    });
    document.getElementById('confirm').addEventListener('click', () => {
      post({ type: 'location-selected', ...picked });
    });
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
  // 地图运行时(leaflet)没加载出来时的失败态 + 重挂 WebView 的 key。
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

  const initialLocation = useMemo<PickedLocation>(
    () => ({
      title: typeof params.title === 'string' ? params.title : '',
      address: typeof params.address === 'string' ? params.address : '',
      latitude: readNumber(params.latitude, 22.5431),
      longitude: readNumber(params.longitude, 114.0579),
    }),
    [params.address, params.latitude, params.longitude, params.title],
  );
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
      let payload: MapMessage;
      try {
        payload = JSON.parse(event.nativeEvent.data) as MapMessage;
      } catch {
        return;
      }
      // 搜索或地址解析失败时仍保留地图上已经选择的经纬度，用户可继续确认。
      if (payload.type === 'map-error') return;
      if (payload.type === 'map-runtime-unavailable') {
        setMapUnavailable(true);
        setLoading(false);
        return;
      }
      if (
        typeof payload.latitude !== 'number' ||
        typeof payload.longitude !== 'number' ||
        !Number.isFinite(payload.latitude) ||
        !Number.isFinite(payload.longitude) ||
        payload.latitude < -90 ||
        payload.latitude > 90 ||
        payload.longitude < -180 ||
        payload.longitude > 180
      ) {
        Alert.alert(labels.invalidTitle, labels.invalidMessage);
        return;
      }
      onConfirm({
        title: payload.title || labels.selectedLabel,
        address: payload.address || '',
        latitude: payload.latitude,
        longitude: payload.longitude,
      });
    },
    [labels.invalidMessage, labels.invalidTitle, labels.selectedLabel, onConfirm],
  );

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
          originWhitelist={['https://*']}
          source={{ html: mapHtml, baseUrl: 'https://www.openstreetmap.org' }}
          javaScriptEnabled
          domStorageEnabled
          onLoadEnd={() => setLoading(false)}
          onMessage={handleMapMessage}
          style={s.webView}
        />
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
  unavailable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
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
