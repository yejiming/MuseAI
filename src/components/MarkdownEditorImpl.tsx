import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MarkdownEditorView } from './MarkdownEditorView';

interface MarkdownEditorProps {
  filePath: string | null;
  readOnly?: boolean;
}

type SaveStatus = 'saved' | 'saving' | 'error';

interface EditorFileState {
  content: string;
  savedContent: string;
  imagePreviewSrc: string;
  loading: boolean;
  saveStatus: SaveStatus;
  readError: boolean;
}

type EditorFileAction =
  | { type: 'clear' }
  | { type: 'text-load-start' }
  | { type: 'text-load-success'; content: string }
  | { type: 'text-load-error'; error: unknown }
  | { type: 'image-load-start' }
  | { type: 'image-load-success'; src: string }
  | { type: 'image-load-error'; error: unknown }
  | { type: 'content-changed'; content: string }
  | { type: 'external-refresh'; content: string }
  | { type: 'save-success'; content: string; isLatest: boolean }
  | { type: 'save-error' };

const initialEditorFileState: EditorFileState = {
  content: '',
  savedContent: '',
  imagePreviewSrc: '',
  loading: false,
  saveStatus: 'saved',
  readError: false,
};

const editorFileReducer = (state: EditorFileState, action: EditorFileAction): EditorFileState => {
  switch (action.type) {
    case 'clear':
      return initialEditorFileState;
    case 'text-load-start':
      return {
        ...state,
        imagePreviewSrc: '',
        loading: true,
        readError: false,
      };
    case 'text-load-success':
      return {
        content: action.content,
        savedContent: action.content,
        imagePreviewSrc: '',
        loading: false,
        saveStatus: 'saved',
        readError: false,
      };
    case 'text-load-error':
      return {
        ...state,
        content: `**读取文件失败**: ${action.error}`,
        savedContent: '',
        loading: false,
        saveStatus: 'error',
        readError: true,
      };
    case 'image-load-start':
      return {
        content: '',
        savedContent: '',
        imagePreviewSrc: '',
        loading: true,
        saveStatus: 'saved',
        readError: false,
      };
    case 'image-load-success':
      return {
        ...state,
        imagePreviewSrc: action.src,
        loading: false,
      };
    case 'image-load-error':
      return {
        ...state,
        content: `**读取图片失败**: ${action.error}`,
        loading: false,
        readError: true,
      };
    case 'content-changed':
      return {
        ...state,
        content: action.content,
        saveStatus: action.content === state.savedContent ? 'saved' : 'saving',
      };
    case 'external-refresh':
      return {
        ...state,
        content: action.content,
        savedContent: action.content,
        saveStatus: 'saved',
      };
    case 'save-success':
      return {
        ...state,
        savedContent: action.content,
        saveStatus: action.isLatest ? 'saved' : state.saveStatus,
      };
    case 'save-error':
      return {
        ...state,
        saveStatus: 'error',
      };
    default:
      return state;
  }
};

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

const isImageFile = (path: string) => {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension ? IMAGE_EXTENSIONS.includes(extension) : false;
};

const getDirectoryName = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

const isExternalImageSrc = (src: string) => /^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('#');

const normalizePath = (path: string) => {
  const absolute = path.startsWith('/');
  const parts = path.split('/').filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `${absolute ? '/' : ''}${stack.join('/')}`;
};

const resolveImageSrc = async (src: string, markdownPath: string) => {
  if (isExternalImageSrc(src)) {
    return src;
  }
  const absolutePath = src.startsWith('/')
    ? src
    : normalizePath(`${getDirectoryName(markdownPath)}/${src}`);
  return invoke<string>('read_image_data_url', { path: absolutePath });
};

const safeMarkdownUrlTransform = (url: string) => {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith('javascript:')) {
    return '';
  }
  if (normalized.startsWith('data:') && !normalized.startsWith('data:image/')) {
    return '';
  }
  return url;
};

const selectionTouchesRange = (view: any, from: number, to: number) => (
  view.state.selection.ranges.some((range: { from: number; to: number }) => range.from <= to && range.to >= from)
);

const overlapsRange = (ranges: Array<{ from: number; to: number }>, from: number, to: number) => (
  ranges.some((range) => from < range.to && to > range.from)
);

interface CodeMirrorRuntime {
  CodeMirror: React.ComponentType<any>;
  createExtensions: (markdownPath: string, readOnly: boolean) => any[];
}

let codeMirrorRuntimePromise: Promise<CodeMirrorRuntime> | null = null;

const loadCodeMirrorRuntime = () => {
  if (!codeMirrorRuntimePromise) {
    codeMirrorRuntimePromise = Promise.all([
      import('@uiw/react-codemirror'),
      import('@codemirror/commands'),
      import('@codemirror/lang-markdown'),
      import('@codemirror/language'),
      import('@codemirror/state'),
      import('@codemirror/view'),
    ]).then(([
      codeMirrorModule,
      commandsModule,
      markdownModule,
      languageModule,
      stateModule,
      viewModule,
    ]) => {
      const { defaultKeymap, history, historyKeymap, indentWithTab } = commandsModule;
      const { markdown } = markdownModule;
      const { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } = languageModule;
      const { EditorState } = stateModule;
      const { Decoration, EditorView, keymap, ViewPlugin, WidgetType } = viewModule;

      class ImagePreviewWidget extends WidgetType {
        constructor(
          private readonly src: string,
          private readonly alt: string,
          private readonly markdownPath: string,
        ) {
          super();
        }

        toDOM() {
          const figure = document.createElement('figure');
          figure.className = 'markdown-live-image';
          const image = document.createElement('img');
          image.alt = this.alt || '图片';
          figure.appendChild(image);
          resolveImageSrc(this.src, this.markdownPath)
            .then((resolvedSrc) => {
              image.src = safeMarkdownUrlTransform(resolvedSrc);
            })
            .catch((err) => {
              console.error('Error resolving markdown image:', err);
              image.src = safeMarkdownUrlTransform(this.src);
            });
          if (this.alt) {
            const caption = document.createElement('figcaption');
            caption.textContent = this.alt;
            figure.appendChild(caption);
          }
          return figure;
        }

        ignoreEvent() {
          return false;
        }
      }

      const markdownLivePreviewExtension = (markdownPath: string) => ViewPlugin.fromClass(class {
        decorations: any;

        constructor(view: any) {
          this.decorations = this.buildDecorations(view);
        }

        update(update: any) {
          if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }

        buildDecorations(view: any) {
          const decorations = [];
          for (const visibleRange of view.visibleRanges) {
            let position = visibleRange.from;
            while (position <= visibleRange.to) {
              const line = view.state.doc.lineAt(position);
              const text = line.text;
              const headingMatch = text.match(/^(#{1,6})\s+/);
              if (headingMatch) {
                const level = Math.min(headingMatch[1].length, 6);
                decorations.push(Decoration.line({ class: `markdown-live-heading markdown-live-heading-${level}` }).range(line.from));
                const markerFrom = line.from;
                const markerTo = line.from + headingMatch[0].length;
                if (!selectionTouchesRange(view, markerFrom, markerTo)) {
                  decorations.push(Decoration.replace({ class: 'markdown-live-hidden-marker' }).range(markerFrom, markerTo));
                }
              }

              const imageRanges: Array<{ from: number; to: number }> = [];
              const addImageDecoration = (from: number, to: number, src: string, alt: string) => {
                if (!selectionTouchesRange(view, from, to) && !overlapsRange(imageRanges, from, to)) {
                  decorations.push(Decoration.replace({
                    widget: new ImagePreviewWidget(src, alt || src, markdownPath),
                  }).range(from, to));
                  imageRanges.push({ from, to });
                }
              };

              for (const match of text.matchAll(/\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\]\([^)]+\)/g)) {
                const from = line.from + (match.index ?? 0);
                addImageDecoration(from, from + match[0].length, match[2], match[1]);
              }

              for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
                const from = line.from + (match.index ?? 0);
                addImageDecoration(from, from + match[0].length, match[2], match[1]);
              }

              for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
                const from = line.from + (match.index ?? 0);
                const altMatch = match[0].match(/\balt=["']([^"']*)["']/i);
                addImageDecoration(from, from + match[0].length, match[1], altMatch?.[1] || match[1]);
              }

              for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
                const start = line.from + (match.index ?? 0);
                const contentFrom = start + 2;
                const contentTo = contentFrom + match[1].length;
                const end = contentTo + 2;
                if (!selectionTouchesRange(view, start, end)) {
                  decorations.push(Decoration.replace({ class: 'markdown-live-hidden-marker' }).range(start, contentFrom));
                  decorations.push(Decoration.mark({ class: 'markdown-live-bold' }).range(contentFrom, contentTo));
                  decorations.push(Decoration.replace({ class: 'markdown-live-hidden-marker' }).range(contentTo, end));
                }
              }

              for (const match of text.matchAll(/(^|[^*])\*([^*\n]+)\*/g)) {
                const matchStart = line.from + (match.index ?? 0);
                const start = matchStart + match[1].length;
                const contentFrom = start + 1;
                const contentTo = contentFrom + match[2].length;
                const end = contentTo + 1;
                if (!selectionTouchesRange(view, start, end)) {
                  decorations.push(Decoration.replace({ class: 'markdown-live-hidden-marker' }).range(start, contentFrom));
                  decorations.push(Decoration.mark({ class: 'markdown-live-italic' }).range(contentFrom, contentTo));
                  decorations.push(Decoration.replace({ class: 'markdown-live-hidden-marker' }).range(contentTo, end));
                }
              }

              if (line.to >= visibleRange.to) {
                break;
              }
              position = line.to + 1;
            }
          }
          return Decoration.set(decorations, true);
        }
      }, {
        decorations: (plugin: any) => plugin.decorations,
      });

      const editorTheme = EditorView.theme({
        '&': {
          minHeight: '100%',
          backgroundColor: 'transparent',
          color: '#4a4642',
          fontSize: '17px',
        },
        '.cm-scroller': {
          minHeight: 'calc(100vh - 210px)',
          paddingBottom: '48px',
          fontFamily: 'Lora, Merriweather, serif',
          lineHeight: '1.8',
        },
        '.cm-content': {
          padding: '18px 0 36px',
        },
        '.cm-line': {
          padding: '0 2px',
        },
        '.cm-gutters': {
          display: 'none',
        },
        '.cm-activeLine': {
          backgroundColor: 'rgba(217, 119, 87, 0.06)',
        },
        '.cm-cursor': {
          borderLeftColor: '#d97757',
        },
        '&.cm-focused': {
          outline: 'none',
        },
      });

      return {
        CodeMirror: codeMirrorModule.default,
        createExtensions: (markdownPath: string, readOnly: boolean) => [
          history(),
          markdown(),
          bracketMatching(),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          markdownLivePreviewExtension(markdownPath),
          editorTheme,
        ],
      };
    });
  }
  return codeMirrorRuntimePromise;
};

const useCodeMirrorRuntime = () => {
  const [codeMirrorRuntime, setCodeMirrorRuntime] = useState<CodeMirrorRuntime | null>(null);

  useEffect(() => {
    let mounted = true;
    loadCodeMirrorRuntime()
      .then((runtime) => {
        if (mounted) {
          setCodeMirrorRuntime(runtime);
        }
      })
      .catch((err) => {
        console.error('Error loading CodeMirror runtime:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return codeMirrorRuntime;
};

const useSyncedRef = <T,>(value: T) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

const useMarkdownEditorView = ({ filePath, readOnly = false }: MarkdownEditorProps) => {
  const [fileState, dispatchFileState] = useReducer(editorFileReducer, initialEditorFileState);
  const codeMirrorRuntime = useCodeMirrorRuntime();
  const { content, savedContent, imagePreviewSrc, loading, saveStatus, readError } = fileState;
  const editorViewRef = useRef<any | null>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
  const latestContentRef = useSyncedRef(content);
  const savedContentRef = useSyncedRef(savedContent);
  const loadingRef = useSyncedRef(loading);
  const readErrorRef = useSyncedRef(readError);
  const lastKnownModifiedAtRef = useRef<number | null>(null);
  const fullSelectionIntentUntilRef = useRef(0);
  const loadRequestIdRef = useRef(0);

  const extensions = useMemo(() => (
    codeMirrorRuntime?.createExtensions(filePath || '', readOnly) ?? []
  ), [codeMirrorRuntime, filePath, readOnly]);
  const CodeMirror = codeMirrorRuntime?.CodeMirror;

  useEffect(() => {
    let mounted = true;
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const acceptsResponse = () => mounted && loadRequestIdRef.current === requestId;

    if (!filePath) {
      dispatchFileState({ type: 'clear' });
      lastKnownModifiedAtRef.current = null;
      return () => {
        mounted = false;
      };
    }

    if (isImageFile(filePath)) {
      dispatchFileState({ type: 'image-load-start' });
      lastKnownModifiedAtRef.current = null;
      invoke<string>('read_image_data_url', { path: filePath })
        .then((src) => {
          if (acceptsResponse()) {
            dispatchFileState({ type: 'image-load-success', src });
          }
        })
        .catch((err) => {
          console.error('Error reading image:', err);
          if (acceptsResponse()) {
            dispatchFileState({ type: 'image-load-error', error: err });
          }
        });
      return () => {
        mounted = false;
      };
    }

    dispatchFileState({ type: 'text-load-start' });
    Promise.all([
      invoke<string>('read_file', { path: filePath }),
      invoke<number>('file_modified_at', { path: filePath }),
    ])
      .then(([text, modifiedAt]) => {
        if (acceptsResponse()) {
          dispatchFileState({ type: 'text-load-success', content: text });
          lastKnownModifiedAtRef.current = modifiedAt;
        }
      })
      .catch((err) => {
        console.error('Error reading file:', err);
        if (acceptsResponse()) {
          dispatchFileState({ type: 'text-load-error', error: err });
        }
      });

    return () => {
      mounted = false;
    };
  }, [filePath, latestContentRef, loadingRef, readErrorRef, savedContentRef]);

  useEffect(() => {
    if (!filePath || isImageFile(filePath)) {
      return;
    }

    const requestId = loadRequestIdRef.current;
    const pollTimer = window.setInterval(() => {
      if (loadingRef.current || readErrorRef.current || latestContentRef.current !== savedContentRef.current) {
        return;
      }

      invoke<number>('file_modified_at', { path: filePath })
        .then((modifiedAt) => {
          if (lastKnownModifiedAtRef.current === null) {
            lastKnownModifiedAtRef.current = modifiedAt;
            return;
          }

          if (modifiedAt === lastKnownModifiedAtRef.current) {
            return;
          }

          return invoke<string>('read_file', { path: filePath }).then((text) => {
            if (loadRequestIdRef.current !== requestId || latestContentRef.current !== savedContentRef.current) {
              return;
            }

            dispatchFileState({ type: 'external-refresh', content: text });
            lastKnownModifiedAtRef.current = modifiedAt;
          });
        })
        .catch((err) => {
          console.error('Error checking file updates:', err);
        });
    }, 1200);

    return () => {
      window.clearInterval(pollTimer);
    };
  }, [filePath, latestContentRef, loadingRef, readErrorRef, savedContentRef]);

  useEffect(() => {
    if (readOnly || !filePath || isImageFile(filePath) || loading || readError || content === savedContent) {
      return;
    }

    const pathToSave = filePath;
    const contentToSave = content;

    const saveTimer = window.setTimeout(() => {
      invoke<number>('write_file', { path: pathToSave, content: contentToSave })
        .then((modifiedAt) => {
          lastKnownModifiedAtRef.current = modifiedAt;
          dispatchFileState({
            type: 'save-success',
            content: contentToSave,
            isLatest: latestContentRef.current === contentToSave,
          });
        })
        .catch((err) => {
          console.error('Error writing file:', err);
          dispatchFileState({ type: 'save-error' });
        });
    }, 800);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [content, filePath, latestContentRef, loading, readError, readOnly, savedContent]);

  const getSelectedSource = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) {
      return '';
    }
    const ranges: string[] = [];
    for (const range of view.state.selection.ranges) {
      if (!range.empty) {
        ranges.push(view.state.doc.sliceString(range.from, range.to));
      }
    }
    return ranges.join('\n');
  }, []);

  const handleCopy = useCallback((event: ClipboardEvent | React.ClipboardEvent<HTMLDivElement>) => {
    const editorShell = editorShellRef.current;
    const target = event.target as Node | null;
    if (!editorShell || (target && !editorShell.contains(target))) {
      return;
    }

    const selectedSource = getSelectedSource();
    const copiedAfterSelectAll = Date.now() <= fullSelectionIntentUntilRef.current;
    const textToCopy = copiedAfterSelectAll ? latestContentRef.current : selectedSource;
    fullSelectionIntentUntilRef.current = 0;
    if (!textToCopy) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if ('nativeEvent' in event) {
      event.nativeEvent.stopImmediatePropagation();
    } else {
      event.stopImmediatePropagation();
    }
    event.clipboardData?.setData('text/plain', textToCopy);
    event.clipboardData?.setData('text/markdown', textToCopy);
  }, [getSelectedSource, latestContentRef]);
  const handleCopyRef = useRef(handleCopy);

  useEffect(() => {
    handleCopyRef.current = handleCopy;
  }, [handleCopy]);

  const handleEditorKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (!target || !editorShellRef.current?.contains(target)) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      fullSelectionIntentUntilRef.current = Date.now() + 5000;
    }
  }, []);

  useEffect(() => {
    const handleDocumentCopy = (event: ClipboardEvent) => {
      handleCopyRef.current(event);
    };
    document.addEventListener('copy', handleDocumentCopy, true);
    return () => {
      document.removeEventListener('copy', handleDocumentCopy, true);
    };
  }, []);

  const insertMarkdown = useCallback((before: string, after = '', placeholder = '') => {
    const view = editorViewRef.current;
    if (!view || readOnly) {
      return;
    }
    const range = view.state.selection.main;
    const selected = view.state.doc.sliceString(range.from, range.to) || placeholder;
    const nextText = `${before}${selected}${after}`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: nextText },
      selection: { anchor: range.from + before.length, head: range.from + before.length + selected.length },
    });
    view.focus();
  }, [readOnly]);

  const insertList = useCallback((ordered: boolean) => {
    const view = editorViewRef.current;
    if (!view || readOnly) {
      return;
    }
    const range = view.state.selection.main;
    const selected = view.state.doc.sliceString(range.from, range.to) || '列表项';
    const lines = selected.split('\n');
    const nextText = lines.map((line: string, index: number) => `${ordered ? `${index + 1}.` : '-'} ${line.replace(/^(\s*(?:[-*+]|\d+\.)\s*)/, '')}`).join('\n');
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: nextText },
      selection: { anchor: range.from, head: range.from + nextText.length },
    });
    view.focus();
  }, [readOnly]);

  const insertLink = useCallback(() => {
    const url = window.prompt('请输入链接地址');
    if (!url) {
      return;
    }
    insertMarkdown('[', `](${url})`, '链接文字');
  }, [insertMarkdown]);

  const insertImage = useCallback(() => {
    const src = window.prompt('请输入图片地址，可以是本地路径或互联网地址');
    if (!src) {
      return;
    }
    insertMarkdown('![图片说明](', ')', src);
  }, [insertMarkdown]);

  const handleChange = useCallback((value: string, _viewUpdate: any) => {
    if (!readOnly) {
      dispatchFileState({ type: 'content-changed', content: value });
    }
  }, [readOnly]);

  const isTestMode = import.meta.env.MODE === 'test';

  return (
    <MarkdownEditorView
      CodeMirror={CodeMirror}
      content={content}
      editorShellRef={editorShellRef}
      extensions={extensions}
      filePath={filePath}
      imagePreviewSrc={imagePreviewSrc}
      isImageFile={Boolean(filePath && isImageFile(filePath))}
      isTestMode={isTestMode}
      loading={loading}
      readOnly={readOnly}
      saveStatus={saveStatus}
      onChange={handleChange}
      onContentChange={(nextContent) => dispatchFileState({ type: 'content-changed', content: nextContent })}
      onCopy={handleCopy}
      onEditorKeyDown={handleEditorKeyDown}
      onEditorView={(view) => {
        editorViewRef.current = view;
      }}
      onInsertImage={insertImage}
      onInsertLink={insertLink}
      onInsertList={insertList}
      onInsertMarkdown={insertMarkdown}
    />
  );
};

const MarkdownEditor: React.FC<MarkdownEditorProps> = (props) => useMarkdownEditorView(props);

export default MarkdownEditor;
