'use dom';

import '@blocknote/react/style.css';

import type { PartialBlock } from '@blocknote/core';
import { en, zh } from '@blocknote/core/locales';
import {
  buildPendingEditorBlocks,
  resolveMediaInsertAnchor,
} from '../utils/note-media-upload';
import { routeMultilineTextInputToPaste } from '../utils/note-editor-text-input';
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
  paragraphType: string;
  bulletListType: string;
  imageTitle: string;
  videoTitle: string;
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
  editable?: boolean;
  /** Shown while the whole document is one empty block. */
  placeholder?: string;
  backgroundColor?: string;
  placeholderColor?: string;
  /**
   * Reports the rendered content height so the native side can size the
   * WebView to its content. When set, the editor lays out in normal flow
   * instead of filling a fixed-height viewport.
   */
  onContentHeightChange?: (height: number) => void;
}

type ActiveType = 'paragraph' | 'heading' | 'bulletListItem';
type ToolbarType = Exclude<ActiveType, 'heading'>;

function insertPendingMedia(
  editor: Pick<
    ReturnType<typeof useCreateBlockNote>,
    'getTextCursorPosition' | 'insertBlocks' | 'document'
  >,
  pendingInserts: readonly PendingInsert[],
): boolean {
  const anchor = resolveMediaInsertAnchor(
    editor.getTextCursorPosition()?.block,
    editor.document,
  );
  if (!anchor) return false;
  editor.insertBlocks(buildPendingEditorBlocks(pendingInserts), anchor, 'after');
  return true;
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
  editable = true,
  placeholder = '',
  backgroundColor,
  placeholderColor,
  onContentHeightChange,
}: Props) {
  const parsedInitial: PartialBlock[] | undefined = (() => {
    if (!initialContent) return undefined;
    try {
      const parsed = JSON.parse(initialContent) as unknown;
      if (!Array.isArray(parsed)) {
        console.warn('[NoteBlockEditor.dom] initialContent JSON is not a block array');
        return undefined;
      }
      const blocks = parsed as PartialBlock[];
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
    // The slash menu is intentionally disabled below because the DOM bridge
    // does not provide BlockNote's ComponentsContext. Only an empty document
    // shows the caller's placeholder; every per-block hint stays empty so the
    // text area stays visually quiet.
    placeholders: {
      default: '',
      emptyDocument: placeholder,
      heading: '',
      toggleListItem: '',
      bulletListItem: '',
      numberedListItem: '',
      checkListItem: '',
      new_comment: '',
      edit_comment: '',
      comment_reply: '',
    },
    // Native clipboard bridges often expose a truncated/invalid HTML payload.
    // The plain-text payload is the source of truth for notes: it keeps long
    // pasted paragraphs intact and still lets BlockNote split lines into blocks.
    pasteHandler: ({ event, editor: activeEditor, defaultPasteHandler }) => {
      const plainText = event.clipboardData?.getData('text/plain');
      if (event.clipboardData?.types.includes('blocknote/html')) {
        return defaultPasteHandler({
          prioritizeMarkdownOverHTML: false,
          plainTextAsMarkdown: false,
        });
      }
      if (typeof plainText === 'string' && plainText.length > 0) {
        activeEditor.pasteText(plainText);
        return true;
      }
      return defaultPasteHandler({
        prioritizeMarkdownOverHTML: false,
        plainTextAsMarkdown: false,
      });
    },
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

  const rootRef = useRef<HTMLDivElement>(null);

  // Capture phase on the wrapper runs before ProseMirror sees the event, so a
  // multi-line IME commit is cancelled before Chromium splits the DOM.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleBeforeInput = (event: InputEvent) => {
      routeMultilineTextInputToPaste(event, (text) => editor.pasteText(text));
    };
    root.addEventListener('beforeinput', handleBeforeInput, true);
    return () => root.removeEventListener('beforeinput', handleBeforeInput, true);
  }, [editor]);

  // Bridge function props are re-proxied on every native render; read the
  // latest through a ref so the observer is set up once.
  const onContentHeightChangeRef = useRef(onContentHeightChange);
  onContentHeightChangeRef.current = onContentHeightChange;
  const fitsContent = onContentHeightChange != null;
  useEffect(() => {
    const root = rootRef.current;
    if (!fitsContent || !root) return;
    let reportedHeight = -1;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === reportedHeight) return;
      reportedHeight = height;
      onContentHeightChangeRef.current?.(height);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [fitsContent]);

  // A batch is inserted in one call so every item stays anchored after the
  // original cursor block in the same order the picker returned it.
  useEffect(() => {
    if (pendingInserts.length === 0 || unmounted.current) return;
    if (!insertPendingMedia(editor, pendingInserts)) {
      // 文档连一个块都没有，BlockNote 正常不会到这里。仍然把这批交割掉：留着
      // 不消费只会让 effect 依赖不变、永远不再触发，等于换一种方式卡死。
      console.warn(
        '[NoteBlockEditor.dom] dropped a media batch: the document had no block to anchor to',
      );
    }
    onInsertHandled();
  }, [pendingInserts, editor, onInsertHandled]);

  function applyType(type: ToolbarType) {
    if (!editable) return;
    const pos = editor.getTextCursorPosition();
    if (!pos?.block) return;

    editor.updateBlock(pos.block, { type } as PartialBlock);
    setActiveType(type);
  }

  const isDark = theme === 'dark';
  const bg = backgroundColor ?? (isDark ? '#000000' : '#ffffff');
  const border = isDark ? '#48484A' : '#E5E7EB';
  const toolbarBg = isDark ? '#000000' : '#ffffff';
  const iconColor = isDark ? '#FFFFFF' : '#6B7280';
  const activeColor = '#6366F1';

  // 工具栏只给正文和列表两种块。标题（H）和代码（<>）已下线：
  // 旧笔记里存过的标题块、代码块照常渲染，只是不再提供新建入口。
  const TYPES: { label: string; type: ToolbarType; title: string }[] = [
    { label: 'T', type: 'paragraph', title: toolbarLabels.paragraphType },
    { label: '≡', type: 'bulletListItem', title: toolbarLabels.bulletListType },
  ];

  return (
    <div
      ref={rootRef}
      className="note-editor"
      style={
        fitsContent
          ? // Normal flow so the root's height is the content height that
            // gets reported; past the native cap the page itself scrolls.
            { display: 'flex', flexDirection: 'column', backgroundColor: bg }
          : {
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
            }
      }
    >
      <style>{`
        html, body {
          margin: 0;
          background-color: ${bg};
        }
        .note-editor .bn-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          background-color: ${bg};
        }
        .note-editor .bn-editor {
          padding: 8px 10px;
          flex: 1;
          background-color: ${bg};
        }
        .note-editor .bn-inline-content {
          overflow-wrap: anywhere;
        }
        .note-editor .bn-container .bn-inline-content:has(> .ProseMirror-trailingBreak:only-child):before {
          font-style: normal;
          ${placeholderColor ? `color: ${placeholderColor};` : ''}
        }
      `}</style>
      {/* Editor scroll area */}
      <div style={
        fitsContent
          ? { display: 'flex', flexDirection: 'column' }
          : {
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflowY: 'auto',
              overscrollBehaviorY: 'contain',
              WebkitOverflowScrolling: 'touch',
            }
      }>
        <BlockNoteViewRaw
          editor={editor}
          editable={editable}
          // The DOM editor supplies its own toolbar. BlockNoteViewRaw from
          // @blocknote/react does not provide a theme package's
          // ComponentsContext, so every built-in controller must stay off;
          // otherwise the slash/emoji menus dereference
          // Components.SuggestionMenu during the first render.
          formattingToolbar={false}
          linkToolbar={false}
          slashMenu={false}
          emojiPicker={false}
          sideMenu={false}
          filePanel={false}
          tableHandles={false}
          comments={false}
          theme={theme}
        />
      </div>

      {/* Custom bottom toolbar. The fit-to-content variant is the compact
          composer bar and carries no chrome. */}
      {fitsContent ? null : (
        <div
          style={{
            pointerEvents: editable ? 'auto' : 'none',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            borderTop: `1px solid ${border}`,
            padding: '4px 8px',
            gap: 4,
            backgroundColor: toolbarBg,
            flexShrink: 0,
          }}
        >
          {TYPES.map((item) => {
            const isActive = activeType === item.type;
            return (
              <button
                disabled={!editable}
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
                disabled={!editable}
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
                disabled={!editable}
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

        </div>
      )}
    </div>
  );
}
