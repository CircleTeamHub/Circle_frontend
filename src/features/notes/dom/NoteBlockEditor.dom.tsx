'use dom';

import '@blocknote/react/style.css';

import type { PartialBlock } from '@blocknote/core';
import { en, zh } from '@blocknote/core/locales';
import { buildPendingEditorBlocks } from '../utils/note-media-upload';
import {
  BlockNoteViewRaw,
  useCreateBlockNote,
  useEditorChange,
  useEditorSelectionChange,
} from '@blocknote/react';
import { useEffect, useRef, useState } from 'react';

interface PendingInsert {
  type: 'image' | 'video';
  url: string;
  objectKey: string;
  width?: number;
  height?: number;
  mimeType?: string;
  size?: number;
  durationMs?: number;
}

// Toolbar 文案不能在 WebView 里走 i18n —— DOM bridge 跑在隔离的 JS realm，
// react-i18next 的 instance 拿不到。统一在 native 侧 translate 后通过 props 传进来。
export interface NoteEditorToolbarLabels {
  headingType: string;
  paragraphType: string;
  bulletListType: string;
  imageTitle: string;
  videoTitle: string;
  codeTitle: string;
}

interface Props {
  dom?: import('expo/dom').DOMProps;
  initialContent: string | null; // JSON string of Block[]
  pendingInserts: PendingInsert[];
  onContentChange: (blocksJson: string) => void; // JSON string — avoids bridge serialization errors
  onInsertHandled: () => void;
  onImageRequest: () => void;
  onVideoRequest: () => void;
  theme?: 'light' | 'dark';
  language?: 'zh' | 'en';
  toolbarLabels: NoteEditorToolbarLabels;
  mediaToolbarEnabled?: boolean;
}

type ActiveType = 'paragraph' | 'heading' | 'bulletListItem';

function insertPendingMedia(
  editor: Pick<ReturnType<typeof useCreateBlockNote>, 'getTextCursorPosition' | 'insertBlocks'>,
  pendingInserts: readonly PendingInsert[],
) {
  const pos = editor.getTextCursorPosition();
  if (!pos?.block) return;
  editor.insertBlocks(
    buildPendingEditorBlocks(pendingInserts),
    pos.block,
    'after',
  );
}

export default function NoteBlockEditor({
  initialContent,
  pendingInserts,
  onContentChange,
  onInsertHandled,
  onImageRequest,
  onVideoRequest,
  theme = 'dark',
  language = 'zh',
  toolbarLabels,
  mediaToolbarEnabled = true,
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

  // Localize the editor (placeholders + slash menu) via BlockNote's built-in
  // dictionaries. i18n can't run inside the DOM bridge realm, so the language
  // is resolved on the native side and passed in as a prop.
  const editor = useCreateBlockNote({
    initialContent: parsedInitial,
    dictionary: language === 'zh' ? zh : en,
  });

  const [activeType, setActiveType] = useState<ActiveType>('paragraph');
  const unmounted = useRef(false);

  // Pass a JSON string across the bridge — Expo DOM bridge cannot serialize
  // BlockNote Block objects directly (they contain non-plain properties that
  // cause "Functions are not supported in arguments").
  // 序列化失败时返回 null 并跳过本次上报：以前回退成 '[]' 会把 native 侧的
  // 正文覆盖成空文档，用户此时点保存就丢内容。保留上一次成功的内容更安全。
  function serializeBlocks(): string | null {
    try {
      return JSON.stringify(editor.document);
    } catch (error) {
      console.warn('[NoteBlockEditor.dom] failed to serialize blocks', error);
      return null;
    }
  }

  // Fire content changes up to native
  useEditorChange(() => {
    if (unmounted.current) return;
    const serialized = serializeBlocks();
    if (serialized != null) onContentChange(serialized);
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

  // A batch is inserted in one call so every item stays anchored after the
  // original cursor block in the same order the picker returned it.
  useEffect(() => {
    if (pendingInserts.length === 0 || unmounted.current) return;
    insertPendingMedia(editor, pendingInserts);
    onInsertHandled();
  }, [pendingInserts, editor, onInsertHandled]);

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
  const border = isDark ? '#565A6B' : '#E5E7EB';
  const toolbarBg = isDark ? '#1A1B23' : '#ffffff';
  const iconColor = isDark ? '#FFFFFF' : '#6B7280';
  const activeColor = '#6366F1';

  const TYPES: { label: string; type: ActiveType; title: string }[] = [
    { label: 'H', type: 'heading', title: toolbarLabels.headingType },
    { label: 'T', type: 'paragraph', title: toolbarLabels.paragraphType },
    { label: '≡', type: 'bulletListItem', title: toolbarLabels.bulletListType },
  ];

  return (
    <div
      style={{
        // Expo DOM mounts this content with no html/body/#root height, so a
        // `height: 100%` here can't resolve and the flex column collapses to
        // content size (the editor shrinks into a small box). Pin to the
        // WebView viewport instead so it always fills the available area.
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
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

        {mediaToolbarEnabled ? (
          <>
            {/* Image — triggers native picker. Uses an SVG icon rather than a CJK
                glyph so it renders consistently regardless of the WebView's font
                fallback (a '图' label showed as tofu on some devices). */}
            <button
              onClick={onImageRequest}
              title={toolbarLabels.imageTitle}
              aria-label={toolbarLabels.imageTitle}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: iconColor,
              }}
            >
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </button>

            {/* Video — triggers native picker, mirrors the image flow. */}
            <button
              onClick={onVideoRequest}
              title={toolbarLabels.videoTitle}
              aria-label={toolbarLabels.videoTitle}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
                color: iconColor,
              }}
            >
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
          </>
        ) : null}

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
