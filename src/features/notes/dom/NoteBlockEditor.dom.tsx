'use dom';

import '@blocknote/react/style.css';

import type { PartialBlock } from '@blocknote/core';
import {
  BlockNoteViewRaw,
  useCreateBlockNote,
  useEditorChange,
  useEditorSelectionChange,
} from '@blocknote/react';
import { useEffect, useRef, useState } from 'react';

interface PendingInsert {
  type: 'image';
  url: string;
  objectKey: string;
  width?: number;
  height?: number;
  mimeType?: string;
  size?: number;
}

interface Props {
  dom?: import('expo/dom').DOMProps;
  initialContent: Record<string, unknown>[] | null;
  pendingInsert: PendingInsert | null;
  onContentChange: (blocks: Record<string, unknown>[]) => void;
  onInsertHandled: () => void;
  onImageRequest: () => void;
  theme?: 'light' | 'dark';
}

type ActiveType = 'paragraph' | 'heading' | 'bulletListItem';

export default function NoteBlockEditor({
  initialContent,
  pendingInsert,
  onContentChange,
  onInsertHandled,
  onImageRequest,
  theme = 'dark',
}: Props) {
  const editor = useCreateBlockNote({
    initialContent:
      initialContent && initialContent.length > 0
        ? (initialContent as PartialBlock[])
        : undefined,
  });

  const [activeType, setActiveType] = useState<ActiveType>('paragraph');
  const unmounted = useRef(false);

  // Serialize editor.document to plain JSON before bridging to native.
  // BlockNote Block objects may contain non-serializable properties; JSON
  // round-trip strips them so the Expo DOM bridge doesn't throw
  // "Functions are not supported in arguments".
  function serializeBlocks(): Record<string, unknown>[] {
    try {
      return JSON.parse(JSON.stringify(editor.document));
    } catch {
      return [];
    }
  }

  // Fire content changes up to native
  useEditorChange(() => {
    if (unmounted.current) return;
    onContentChange(serializeBlocks());
  }, editor);

  // Track cursor block type for toolbar highlight
  useEditorSelectionChange(() => {
    const pos = editor.getTextCursorPosition();
    if (pos?.block) {
      setActiveType((pos.block.type as ActiveType) ?? 'paragraph');
    }
  }, editor);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  // Insert a pending image from native
  useEffect(() => {
    if (!pendingInsert || unmounted.current) return;
    const pos = editor.getTextCursorPosition();
    editor.insertBlocks(
      [
        {
          type: 'image',
          props: {
            url: pendingInsert.url,
            previewWidth: 300,
            caption: '',
          },
        },
      ],
      pos.block,
      'after',
    );
    onInsertHandled();
  }, [pendingInsert, editor, onInsertHandled]);

  function applyType(type: ActiveType) {
    const pos = editor.getTextCursorPosition();
    if (!pos?.block) return;
    if (type === 'heading') {
      editor.updateBlock(pos.block, { type: 'heading', props: { level: 1 } });
    } else {
      editor.updateBlock(pos.block, { type } as PartialBlock);
    }
    setActiveType(type);
  }

  const isDark = theme === 'dark';
  const bg = isDark ? '#1A1B23' : '#ffffff';
  const border = isDark ? '#2D2E3A' : '#E5E7EB';
  const toolbarBg = isDark ? '#1A1B23' : '#ffffff';
  const iconColor = isDark ? '#9CA3AF' : '#6B7280';
  const activeColor = '#6366F1';

  const TYPES: { label: string; type: ActiveType; title: string }[] = [
    { label: 'H', type: 'heading', title: '标题' },
    { label: 'T', type: 'paragraph', title: '正文' },
    { label: '≡', type: 'bulletListItem', title: '列表' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: bg,
      }}
    >
      {/* Editor scroll area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <BlockNoteViewRaw
          editor={editor}
          editable
          formattingToolbar={false}
          sideMenu={false}
          theme={theme}
        />
      </div>

      {/* Custom bottom toolbar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          borderTop: `1px solid ${border}`,
          padding: '8px 12px',
          gap: 4,
          backgroundColor: toolbarBg,
          flexShrink: 0,
        }}
      >
        {TYPES.map((item) => {
          const isActive = activeType === item.type;
          return (
            <button
              key={item.type}
              onClick={() => applyType(item.type)}
              title={item.title}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 700,
                fontFamily: 'system-ui, sans-serif',
                background: isActive ? activeColor : 'transparent',
                color: isActive ? '#ffffff' : iconColor,
                transition: 'background 0.15s',
              }}
            >
              {item.label}
            </button>
          );
        })}

        {/* Image — triggers native picker */}
        <button
          onClick={onImageRequest}
          title="图片"
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'system-ui, sans-serif',
            background: 'transparent',
            color: iconColor,
          }}
        >
          图
        </button>

        {/* Code */}
        <button
          onClick={() => {
            const pos = editor.getTextCursorPosition();
            if (pos?.block) {
              editor.updateBlock(pos.block, { type: 'codeBlock' } as PartialBlock);
            }
          }}
          title="代码"
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'monospace',
            background: 'transparent',
            color: iconColor,
          }}
        >
          {'<>'}
        </button>
      </div>
    </div>
  );
}
