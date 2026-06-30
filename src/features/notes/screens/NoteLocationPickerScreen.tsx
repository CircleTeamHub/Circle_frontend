import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  type PickedNoteLocation,
  useNoteLocationPickerStore,
} from '@/features/notes/store/use-note-location-picker-store';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type MapMessage =
  | ({ type: 'location-selected' } & PickedNoteLocation)
  | { type: 'map-error'; message?: string };

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

function buildMapHtml({
  latitude,
  longitude,
  title,
  address,
}: PickedNoteLocation) {
  const safeTitle = escapeHtml(title);
  const safeAddress = escapeHtml(address);
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; background: #111827; }
    .panel {
      position: fixed;
      left: 12px;
      right: 12px;
      top: 12px;
      z-index: 1000;
      display: grid;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .search { display: flex; gap: 8px; }
    input {
      flex: 1;
      border: 0;
      border-radius: 8px;
      padding: 11px 12px;
      font-size: 15px;
      color: #111827;
      background: #fff;
    }
    button {
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
      background: rgba(17, 24, 39, .86);
      color: #fff;
      line-height: 1.4;
    }
    .picked small { display: block; color: #d1d5db; margin-top: 2px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="panel">
    <div class="search">
      <input id="query" placeholder="搜索地点" value="${safeTitle || safeAddress}">
      <button id="search">搜索</button>
    </div>
    <div class="picked">
      <div id="picked-title">${safeTitle || '已选择位置'}</div>
      <small id="picked-address">${safeAddress}</small>
    </div>
    <button id="confirm">使用这个位置</button>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    const map = L.map('map', { zoomControl: false }).setView([${latitude}, ${longitude}], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const marker = L.marker([${latitude}, ${longitude}], { draggable: true }).addTo(map);
    let picked = {
      title: ${JSON.stringify(title || '已选择位置')},
      address: ${JSON.stringify(address || '')},
      latitude: ${latitude},
      longitude: ${longitude}
    };

    function updatePicked(next) {
      picked = { ...picked, ...next };
      document.getElementById('picked-title').textContent = picked.title || '已选择位置';
      document.getElementById('picked-address').textContent = picked.address || '';
      marker.setLatLng([picked.latitude, picked.longitude]);
    }

    async function reverseGeocode(lat, lon) {
      updatePicked({ latitude: lat, longitude: lon, title: '已选择位置', address: lat.toFixed(5) + ', ' + lon.toFixed(5) });
      try {
        const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        const data = await response.json();
        updatePicked({
          title: data.name || data.display_name?.split(',')[0] || '已选择位置',
          address: data.display_name || picked.address
        });
      } catch (error) {
        post({ type: 'map-error', message: 'reverse failed' });
      }
    }

    async function searchPlace() {
      const query = document.getElementById('query').value.trim();
      if (!query) return;
      try {
        const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(query);
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        const rows = await response.json();
        if (!rows.length) return;
        const row = rows[0];
        const lat = Number(row.lat);
        const lon = Number(row.lon);
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
  </script>
</body>
</html>`;
}

export default function NoteLocationPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    latitude?: string;
    longitude?: string;
    title?: string;
    address?: string;
  }>();
  const setPickedLocation = useNoteLocationPickerStore((state) => state.setPickedLocation);
  const [loading, setLoading] = useState(true);

  const initialLocation = useMemo<PickedNoteLocation>(
    () => ({
      title: typeof params.title === 'string' ? params.title : '',
      address: typeof params.address === 'string' ? params.address : '',
      latitude: readNumber(params.latitude, 22.5431),
      longitude: readNumber(params.longitude, 114.0579),
    }),
    [params.address, params.latitude, params.longitude, params.title],
  );
  const mapHtml = useMemo(() => buildMapHtml(initialLocation), [initialLocation]);

  const handleMapMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let payload: MapMessage;
      try {
        payload = JSON.parse(event.nativeEvent.data) as MapMessage;
      } catch {
        return;
      }
      if (payload.type === 'map-error') return;
      if (
        typeof payload.latitude !== 'number' ||
        typeof payload.longitude !== 'number' ||
        !Number.isFinite(payload.latitude) ||
        !Number.isFinite(payload.longitude)
      ) {
        Alert.alert('位置无效', '请重新选择位置');
        return;
      }
      setPickedLocation({
        title: payload.title || '已选择位置',
        address: payload.address || '',
        latitude: payload.latitude,
        longitude: payload.longitude,
      });
      router.back();
    },
    [router, setPickedLocation],
  );

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: colors.text }]}>选择位置</Text>
        <View style={s.headerSpacer} />
      </View>
      <View style={s.mapFrame}>
        {loading ? (
          <View style={[s.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        <WebView
          originWhitelist={['https://*']}
          source={{ html: mapHtml, baseUrl: 'https://www.openstreetmap.org' }}
          javaScriptEnabled
          domStorageEnabled
          onLoadEnd={() => setLoading(false)}
          onMessage={handleMapMessage}
          style={s.webView}
        />
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
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    ...Typography.h3,
    fontWeight: '700',
  },
  headerSpacer: { width: 24 },
  mapFrame: {
    flex: 1,
    margin: Spacing.lg,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webView: { flex: 1 },
});
