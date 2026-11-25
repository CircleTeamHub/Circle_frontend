type DOMComponent = typeof import('@/features/notes/dom/NoteBlockEditor.dom').default;

let component: DOMComponent | null = null;

export function getNoteBlockEditorDOM(): DOMComponent {
  // Native keeps its existing lazy synchronous Expo DOM bridge load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  component ??= require('@/features/notes/dom/NoteBlockEditor.dom').default as DOMComponent;
  return component;
}
