# Photo Markup Export Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent high-megapixel photo markup export from allocating an unbounded Skia surface and JavaScript byte buffer.

**Architecture:** Derive a bounded export size before building the off-screen Skia scene. Preserve aspect ratio and existing normalized-stroke rendering, and return the actual exported dimensions to callers.

**Tech Stack:** React Native, TypeScript, React 19, `@shopify/react-native-skia`, Jest, Testing Library.

## Global Constraints

- Export long edge is at most 4096 pixels.
- Never upscale an image whose long edge is already at or below 4096 pixels.
- Preserve the source aspect ratio, PNG/JPEG choice, and JPEG quality 92.
- Do not change gesture collection or normalized markup coordinates.

---

### Task 1: Bound off-screen export dimensions

**Files:**
- Modify: `src/features/chat/components/photo-markup-editor.tsx:65-67,289-323`
- Test: `src/features/chat/components/photo-markup-editor.spec.tsx`

**Interfaces:**
- Consumes: `ImagePickerAsset.width`, `ImagePickerAsset.height`, normalized `PhotoMarkupStroke[]`.
- Produces: `boundedPhotoExportSize(width: number, height: number): { width: number; height: number }` and bounded `ExportedMarkupPhoto` dimensions.

- [x] **Step 1: Write the failing tests**

```tsx
it('caps a high-resolution export to a 4096px long edge', () => {
  expect(boundedPhotoExportSize(8000, 6000)).toEqual({ width: 4096, height: 3072 });
});

it('does not upscale an image inside the export budget', () => {
  expect(boundedPhotoExportSize(1200, 600)).toEqual({ width: 1200, height: 600 });
});

it('renders and reports the bounded export dimensions', async () => {
  // Render with an 8000x6000 asset, add one stroke, export through the ref,
  // and assert drawAsImage receives 4096x3072 and the DTO reports 4096x3072.
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx jest src/features/chat/components/photo-markup-editor.spec.tsx --runInBand`

Expected: FAIL because `boundedPhotoExportSize` does not exist and export still uses `asset.width` / `asset.height`.

- [x] **Step 3: Implement the minimal size budget**

```ts
export const PHOTO_MARKUP_EXPORT_MAX_EDGE = 4096;

export function boundedPhotoExportSize(width: number, height: number) {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= PHOTO_MARKUP_EXPORT_MAX_EDGE) return { width, height };
  const scale = PHOTO_MARKUP_EXPORT_MAX_EDGE / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
```

Inside `exportImage`, compute `exportSize`, pass it to both `MarkupScene` and `drawAsImage`, and return `exportSize.width` / `exportSize.height` in `ExportedMarkupPhoto`.

- [x] **Step 4: Run focused and static verification**

Run: `npx jest src/features/chat/components/photo-markup-editor.spec.tsx --runInBand`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [x] **Step 5: Review and commit**

```bash
git diff --check
git add src/features/chat/components/photo-markup-editor.tsx src/features/chat/components/photo-markup-editor.spec.tsx docs/superpowers/plans/2026-08-18-photo-markup-export-budget.md
git commit -m "fix(chat): bound photo markup export memory"
```
