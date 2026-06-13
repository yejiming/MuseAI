import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownEditor from '../components/MarkdownEditor';

const invokeMock = vi.mocked(invoke);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('MarkdownEditor', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_file') return '# 标题\n\n正文';
      if (command === 'file_modified_at') return 1;
      if (command === 'write_file') return 2;
      if (command === 'read_image_data_url') return 'data:image/png;base64,LOCAL';
      return undefined;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads a large Markdown document into an editable CodeMirror source area', async () => {
    const largeMarkdown = Array.from({ length: 900 }, (_, index) => `## 第 ${index + 1} 节\n正文内容`).join('\n\n');
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_file') return largeMarkdown;
      if (command === 'file_modified_at') return 1;
      return undefined;
    });

    render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/large.md" />);

    const editor = await screen.findByRole('textbox', { name: 'Markdown源码编辑区' }, { timeout: 3000 });
    expect((editor as HTMLTextAreaElement).value).toContain('第 900 节');
    expect(screen.getByTestId('markdown-live-editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '分屏' })).not.toBeInTheDocument();
  });

  it('autosaves writable edits but does not save in read-only mode', async () => {
    const { unmount } = render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/a.md" />);

    const editor = await screen.findByRole('textbox', { name: 'Markdown源码编辑区' });
    fireEvent.change(editor, { target: { value: '# 新标题\n\n新正文' } });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('write_file', {
        path: '/Users/test/Documents/MuseAI/articles/a.md',
        content: '# 新标题\n\n新正文',
      });
    });

    unmount();
    invokeMock.mockClear();
    render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/references/read-only.md" readOnly />);

    const readOnlyEditor = await screen.findByRole('textbox', { name: 'Markdown源码编辑区' });
    fireEvent.change(readOnlyEditor, { target: { value: '不应保存' } });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    expect(invokeMock).not.toHaveBeenCalledWith('write_file', expect.anything());
  });

  it('refreshes from disk when the file changes without unsaved edits', async () => {
    let modifiedAt = 1;
    let fileContent = '# 初始内容';
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_file') return fileContent;
      if (command === 'file_modified_at') return modifiedAt;
      return undefined;
    });

    render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/refresh.md" />);

    expect(await screen.findByDisplayValue('# 初始内容')).toBeInTheDocument();

    fileContent = '# 外部更新';
    modifiedAt = 2;

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1300));
    });

    expect(await screen.findByDisplayValue('# 外部更新')).toBeInTheDocument();
  });

  it('renders local and internet Markdown images inside the single editor without rewriting saved source', async () => {
    const markdown = [
      '# 图片段落',
      '',
      '![本地](./cover.png)',
      '',
      '<img src="preview.jpg" width="100%">',
      '',
      '[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://www.python.org/)',
    ].join('\n');
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_file') return markdown;
      if (command === 'file_modified_at') return 1;
      if (command === 'read_image_data_url') {
        return 'data:image/png;base64,LOCAL';
      }
      return undefined;
    });

    render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/chapter.md" />);

    const liveEditor = await screen.findByTestId('markdown-live-editor');
    await waitFor(() => {
      expect(within(liveEditor).getByAltText('本地')).toHaveAttribute('src', 'data:image/png;base64,LOCAL');
      expect(within(liveEditor).getByAltText('preview.jpg')).toHaveAttribute('src', 'data:image/png;base64,LOCAL');
      expect(within(liveEditor).getByAltText('Python')).toHaveAttribute('src', 'https://img.shields.io/badge/Python-3.10%2B-blue');
    });
    const renderedEditor = liveEditor.querySelector('.cm-content');
    expect(renderedEditor).not.toHaveTextContent('<img src=');
    expect(renderedEditor).not.toHaveTextContent('](https://www.python.org/)');

    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown源码编辑区' }), {
      target: { value: `${markdown}\n\n新增` },
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    expect(invokeMock).toHaveBeenCalledWith('write_file', {
      path: '/Users/test/Documents/MuseAI/articles/chapter.md',
      content: `${markdown}\n\n新增`,
    });
  });

  it('previews selected image files directly', async () => {
    render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/cover.jpg" />);

    const image = await screen.findByAltText('cover.jpg');
    expect(image).toHaveAttribute('src', 'data:image/png;base64,LOCAL');
  });

  it('ignores stale text file loads after switching to another text file', async () => {
    const firstRead = deferred<string>();
    const firstModifiedAt = deferred<number>();
    invokeMock.mockImplementation((command: string, args?: any) => {
      if (command === 'read_file' && args?.path?.endsWith('/first.md')) return firstRead.promise;
      if (command === 'file_modified_at' && args?.path?.endsWith('/first.md')) return firstModifiedAt.promise;
      if (command === 'read_file' && args?.path?.endsWith('/second.md')) return Promise.resolve('# 第二篇');
      if (command === 'file_modified_at' && args?.path?.endsWith('/second.md')) return Promise.resolve(2);
      if (command === 'write_file') return Promise.resolve(3);
      return Promise.resolve(undefined);
    });

    const { rerender } = render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/first.md" />);
    rerender(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/second.md" />);

    expect(await screen.findByDisplayValue('# 第二篇')).toBeInTheDocument();

    await act(async () => {
      firstRead.resolve('# 第一篇');
      firstModifiedAt.resolve(1);
      await Promise.resolve();
    });

    expect(screen.queryByDisplayValue('# 第一篇')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('# 第二篇')).toBeInTheDocument();
  });

  it('ignores stale text file loads after switching to image and empty selections', async () => {
    const textRead = deferred<string>();
    const textModifiedAt = deferred<number>();
    invokeMock.mockImplementation((command: string, args?: any) => {
      if (command === 'read_file' && args?.path?.endsWith('/slow.md')) return textRead.promise;
      if (command === 'file_modified_at' && args?.path?.endsWith('/slow.md')) return textModifiedAt.promise;
      if (command === 'read_image_data_url') return Promise.resolve('data:image/png;base64,IMAGE');
      if (command === 'write_file') return Promise.resolve(2);
      return Promise.resolve(undefined);
    });

    const { rerender } = render(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/slow.md" />);
    rerender(<MarkdownEditor filePath="/Users/test/Documents/MuseAI/articles/cover.png" />);

    const image = await screen.findByAltText('cover.png');
    expect(image).toHaveAttribute('src', 'data:image/png;base64,IMAGE');

    await act(async () => {
      textRead.resolve('# 过期正文');
      textModifiedAt.resolve(1);
      await Promise.resolve();
    });

    expect(screen.queryByDisplayValue('# 过期正文')).not.toBeInTheDocument();

    rerender(<MarkdownEditor filePath={null} />);
    expect(screen.getByText('选择左侧文件以开始阅读或编辑')).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    expect(invokeMock).not.toHaveBeenCalledWith('write_file', expect.anything());
  });
});
