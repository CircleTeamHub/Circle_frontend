import { lazy, Suspense, useState, type ComponentProps } from 'react';
import { ActivityIndicator } from 'react-native';

type DOMComponent = typeof import('@/features/notes/dom/NoteBlockEditor.dom').default;

function WebDOMEditor(props: ComponentProps<DOMComponent>) {
  // A route retry remounts this wrapper and can retry a rejected chunk download.
  const [Editor] = useState(() => lazy(() => import('@/features/notes/dom/NoteBlockEditor.dom')));
  return (
    <Suspense fallback={<ActivityIndicator accessible accessibilityRole="progressbar" />}>
      <Editor {...props} />
    </Suspense>
  );
}

export function getNoteBlockEditorDOM() {
  return WebDOMEditor;
}
