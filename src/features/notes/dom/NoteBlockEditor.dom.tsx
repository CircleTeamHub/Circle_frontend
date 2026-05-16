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

// Toolbar 文案不能在 WebView 里走 i18n —— DOM bridge 跑在隔离的 JS realm，
// react-i18next 的 instance 拿不到。统一在 native 侧 translate 后通过 props 传进来。
export interface NoteEditorToolbarLabels {
  headingType: string;
  paragraphType: string;
  bulletListType: string;
  imageTitle: string;
  imageLabel: string;
  codeTitle: string;
}

interface Props {
  dom?: import('expo/dom').DOMProps;
  initialContent: string | null; // JSON string of Block[]
  pendingInsert: PendingInsert | null;
  onContentChange: (blocksJson: string) => void; // JSON string — avoids bridge serialization errors
  onInsertHandled: () => void;
  onImageRequest: () => void;
  theme?: 'light' | 'dark';
  toolbarLabels: NoteEditorToolbarLabels;
}

type ActiveType = 'paragraph' | 'heading' | 'bulletListItem';

export default function NoteBlockEditor({
  initialContent,
  pendingInsert,
  onContentChange,
  onInsertHandled,
  onImageRequest,
  theme = 'dark',
  toolbarLabels,
}: Props) {
  const parsedInitial: PartialBlock[] | undefined = (() => {
    if (!initialContent) return undefined;
    try {
      const blocks = JSON.parse(initialContent) as PartialBlock[];
      return blocks.length > 0 ? blocks : undefined;
    } catch (error) {
      // 一旦保存的笔记 content JSON 变畸形（比如后端 schema 改动 / 旧版本残留），
      // 这里静默返回 undefined 等于用户看到一篇空文档。dev 时把原因暴露出来便于排查。
      // 注意：DOM bridge 跑在 WebView 里没有 `__DEV__`，但 console.warn 总是可用。
      console.warn(
        '[NoteBlockEditor.dom] failed to parse initialContent JSON',
        error,
      );
      return undefined;
    }
  })();

  const editor = useCreateBlockNote({ initialContent: parsedInitial });

  const [activeType, setActiveType] = useState<ActiveType>('paragraph');
  const unmounted = useRef(false);

  // Pass a JSON string across the bridge — Expo DOM bridge cannot serialize
  // BlockNote Block objects directly (they contain non-plain properties that
  // cause "Functions are not supported in arguments").
  function serializeBlocks(): string {
    try {
      return JSON.stringify(editor.document);
    } catch {
      return '[]';
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
    { label: 'H', type: 'heading', title: toolbarLabels.headingType },
    { label: 'T', type: 'paragraph', title: toolbarLabels.paragraphType },
    { label: '≡', type: 'bulletListItem', title: toolbarLabels.bulletListType },
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
          title={toolbarLabels.imageTitle}
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
          {toolbarLabels.imageLabel}
        </button>

        {/* Code */}
        <button
          onClick={() => {
            const pos = editor.getTextCursorPosition();
            if (pos?.block) {
              editor.updateBlock(pos.block, { type: 'codeBlock' } as PartialBlock);
            }
          }}
          title={toolbarLabels.codeTitle}
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
