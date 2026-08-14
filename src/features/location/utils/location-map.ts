const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;

export function hasValidLocationCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): latitude is number {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function getOpenStreetMapTileUrl(
  latitude: number,
  longitude: number,
  zoom = 15,
): string | null {
  if (!hasValidLocationCoordinates(latitude, longitude)) return null;
  const safeZoom = Math.min(19, Math.max(0, Math.round(zoom)));
  const tileCount = 2 ** safeZoom;
  const mercatorLatitude = Math.min(
    WEB_MERCATOR_MAX_LATITUDE,
    Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
  const latitudeRadians = (mercatorLatitude * Math.PI) / 180;
  const x = Math.min(
    tileCount - 1,
    Math.max(0, Math.floor(((longitude + 180) / 360) * tileCount)),
  );
  const y = Math.min(
    tileCount - 1,
    Math.max(
      0,
      Math.floor(
        ((1 -
          Math.log(
            Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians),
          ) /
            Math.PI) /
          2) *
          tileCount,
      ),
    ),
  );
  return `https://tile.openstreetmap.org/${safeZoom}/${x}/${y}.png`;
}

export function getOpenStreetMapPreviewTiles(
  latitude: number,
  longitude: number,
  width: number,
  height: number,
  zoom = 15,
): {
  tiles: { url: string; left: number; top: number }[];
  markerLeft: number;
  markerTop: number;
} | null {
  if (
    !hasValidLocationCoordinates(latitude, longitude) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const safeZoom = Math.min(19, Math.max(0, Math.round(zoom)));
  const tileCount = 2 ** safeZoom;
  const worldSize = tileCount * 256;
  const mercatorLatitude = Math.min(
    WEB_MERCATOR_MAX_LATITUDE,
    Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
  const latitudeRadians = (mercatorLatitude * Math.PI) / 180;
  const worldX = ((longitude + 180) / 360) * worldSize;
  const worldY =
    ((1 -
      Math.log(
        Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians),
      ) /
        Math.PI) /
      2) *
    worldSize;
  const leftEdge = worldX - width / 2;
  const topEdge = worldY - height / 2;
  const minTileX = Math.floor(leftEdge / 256);
  const maxTileX = Math.floor((leftEdge + width - 1) / 256);
  const minTileY = Math.floor(topEdge / 256);
  const maxTileY = Math.floor((topEdge + height - 1) / 256);
  const tiles: { url: string; left: number; top: number }[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        url: `https://tile.openstreetmap.org/${safeZoom}/${wrappedTileX}/${tileY}.png`,
        left: tileX * 256 - leftEdge,
        top: tileY * 256 - topEdge,
      });
    }
  }
  return {
    tiles,
    markerLeft: width / 2,
    markerTop: height / 2,
  };
}

export function buildSystemMapUrls(
  latitude: number,
  longitude: number,
  label: string,
) {
  const coordinates = `${latitude},${longitude}`;
  const encodedLabel = encodeURIComponent(label || coordinates);
  return {
    ios: `maps://?ll=${coordinates}&q=${encodedLabel}`,
    android: `geo:${coordinates}?q=${coordinates}(${encodedLabel})`,
    fallback: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
  };
}
