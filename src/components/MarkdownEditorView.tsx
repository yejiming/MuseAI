import React from 'react';
import { BoldOutlined, ItalicOutlined, LinkOutlined, OrderedListOutlined, PictureOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Button, Input, Space, Spin, Tooltip, Typography } from 'antd';

type SaveStatus = 'saved' | 'saving' | 'error';

interface MarkdownEditorViewProps {
  CodeMirror?: React.ComponentType<any>;
  content: string;
  editorShellRef: React.RefObject<HTMLDivElement | null>;
  extensions: unknown[];
  filePath: string | null;
  imagePreviewSrc: string;
  isImageFile: boolean;
  isTestMode: boolean;
  loading: boolean;
  readOnly: boolean;
  saveStatus: SaveStatus;
  onChange: (value: string, viewUpdate: any) => void;
  onContentChange: (content: string) => void;
  onCopy: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onEditorKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onEditorView: (view: any) => void;
  onInsertImage: () => void;
  onInsertLink: () => void;
  onInsertList: (ordered: boolean) => void;
  onInsertMarkdown: (before: string, after?: string, placeholder?: string) => void;
}

export const MarkdownEditorView: React.FC<MarkdownEditorViewProps> = (props) => {
  if (!props.filePath) {
    return renderEmptyState();
  }
  if (props.isImageFile) {
    return renderImagePreview(props);
  }
  return renderTextEditor(props);
};

const renderEmptyState = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
    <Typography.Text type="secondary">选择左侧文件以开始阅读或编辑</Typography.Text>
  </div>
);

const renderImagePreview = ({ filePath, imagePreviewSrc, loading }: MarkdownEditorViewProps) => (
  <div style={{ height: '100%', overflow: 'auto', padding: '32px 48px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf9f5' }}>
    {loading ? (
      <Spin />
    ) : (
      <img
        src={imagePreviewSrc}
        alt={filePath?.split(/[\\/]/).pop() || '图片预览'}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
      />
    )}
  </div>
);

const renderTextEditor = (props: MarkdownEditorViewProps) => {
  const CodeMirror = props.CodeMirror;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '32px 48px' }}>
      {props.loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Spin />
        </div>
      ) : (
        <div
          className="markdown-editor-shell"
          ref={props.editorShellRef}
          onCopyCapture={props.onCopy}
          onKeyDownCapture={props.onEditorKeyDown}
        >
          <div className="markdown-save-status">
            {props.saveStatus === 'saving' ? '保存中' : props.saveStatus === 'error' ? '保存失败' : '已保存'}
          </div>
          <div className="markdown-editor-toolbar" aria-label="Markdown编辑工具栏">
            <Space size={6} wrap>
              <Tooltip title="加粗">
                <Button aria-label="加粗" icon={<BoldOutlined />} size="small" onClick={() => props.onInsertMarkdown('**', '**', '加粗文字')} disabled={props.readOnly} />
              </Tooltip>
              <Tooltip title="斜体">
                <Button aria-label="斜体" icon={<ItalicOutlined />} size="small" onClick={() => props.onInsertMarkdown('*', '*', '斜体文字')} disabled={props.readOnly} />
              </Tooltip>
              <Tooltip title="无序列表">
                <Button aria-label="无序列表" icon={<UnorderedListOutlined />} size="small" onClick={() => props.onInsertList(false)} disabled={props.readOnly} />
              </Tooltip>
              <Tooltip title="有序列表">
                <Button aria-label="有序列表" icon={<OrderedListOutlined />} size="small" onClick={() => props.onInsertList(true)} disabled={props.readOnly} />
              </Tooltip>
              <Tooltip title="链接">
                <Button aria-label="链接" icon={<LinkOutlined />} size="small" onClick={props.onInsertLink} disabled={props.readOnly} />
              </Tooltip>
              <Tooltip title="图片">
                <Button aria-label="图片" icon={<PictureOutlined />} size="small" onClick={props.onInsertImage} disabled={props.readOnly} />
              </Tooltip>
            </Space>
          </div>
          <div className="markdown-editor-layout">
            <div className="markdown-source-panel" data-testid="markdown-live-editor">
              {props.isTestMode && (
                <Input.TextArea
                  value={props.content}
                  aria-label="Markdown源码编辑区"
                  className="markdown-editor-test-fallback"
                  readOnly={props.readOnly}
                  onChange={(event) => {
                    if (!props.readOnly) {
                      props.onContentChange(event.target.value);
                    }
                  }}
                />
              )}
              {CodeMirror ? (
                <CodeMirror
                  value={props.content}
                  aria-label="Markdown源码编辑区"
                  className="muse-codemirror-editor"
                  basicSetup={false}
                  editable={!props.readOnly}
                  readOnly={props.readOnly}
                  extensions={props.extensions}
                  placeholder="开始写作..."
                  onChange={props.onChange}
                  onCreateEditor={props.onEditorView}
                  onUpdate={(viewUpdate: any) => {
                    if (viewUpdate.view) {
                      props.onEditorView(viewUpdate.view);
                    }
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
                  <Spin />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
