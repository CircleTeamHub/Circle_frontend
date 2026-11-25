import type { ComponentProps, ComponentType } from 'react';

type DOMComponent = typeof import('@/features/notes/dom/NoteBlockEditor.dom').default;
export type NoteEditorDOMProps = ComponentProps<DOMComponent> & { onModuleReady?: () => void };

let component: DOMComponent | null = null;

export function getNoteBlockEditorDOM(): ComponentType<NoteEditorDOMProps> {
  // Native keeps its existing lazy synchronous Expo DOM bridge load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  component ??= require('@/features/notes/dom/NoteBlockEditor.dom').default as DOMComponent;
  return component;
}
