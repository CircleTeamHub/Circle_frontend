// Delivery-scoped display URLs never enter message DTOs, outbox or snapshots.
const previews = new Map<string, { userID: string; url: string }>();
const MAX_IMAGE_PREVIEWS = 256;

export function setImagePreview(deliveryId: string, userID: string, url: string): void {
  previews.delete(deliveryId);
  previews.set(deliveryId, { userID, url });
  if (previews.size > MAX_IMAGE_PREVIEWS) {
    const oldest = previews.keys().next().value;
    if (oldest !== undefined) previews.delete(oldest);
  }
}
export function getImagePreview(deliveryId: string | null, userID: string | null): string | undefined {
  if (!deliveryId || !userID) return undefined;
  const preview = previews.get(deliveryId);
  return preview?.userID === userID ? preview.url : undefined;
}
export function deleteImagePreview(deliveryId: string): void { previews.delete(deliveryId); }
export function clearImagePreviews(): void { previews.clear(); }
