import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import type { NoteEditorDOMProps } from './note-editor-loader';

function DOMModuleReady({ notify }: { notify?: () => void }) {
  useLayoutEffect(() => { notify?.(); }, [notify]);
  return null;
}

function WebDOMEditor({ onModuleReady, ...props }: NoteEditorDOMProps) {
  // A route retry remounts this wrapper and can retry a rejected chunk download.
  const [Editor] = useState(() => lazy(() => import('@/features/notes/dom/NoteBlockEditor.dom')));
  return (
    <Suspense fallback={<ActivityIndicator accessible accessibilityRole="progressbar" />}>
      <Editor {...props} />
      <DOMModuleReady notify={onModuleReady} />
    </Suspense>
  );
}

export function getNoteBlockEditorDOM() {
  return WebDOMEditor;
}
