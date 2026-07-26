import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isLocalWebPreviewHost: vi.fn(),
  isMobile: vi.fn(),
  listen: vi.fn(),
  setWorksDirectory: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('../utils/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/runtime')>();
  return {
    ...original,
    isLocalWebPreviewHost: mocks.isLocalWebPreviewHost,
    isMobile: mocks.isMobile,
  };
});

vi.mock('../stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: { setWorksDirectory: typeof mocks.setWorksDirectory }) => unknown) =>
    selector({ setWorksDirectory: mocks.setWorksDirectory }),
}));

vi.mock('../components/AppShell', () => ({
  default: () => <div>桌面应用外壳</div>,
}));

vi.mock('../components/MobileShell', () => ({
  default: () => <div>移动应用外壳</div>,
}));

describe('App runtime boundary', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.isLocalWebPreviewHost.mockReset();
    mocks.isMobile.mockReset();
    mocks.setWorksDirectory.mockReset();
    mocks.invoke.mockResolvedValue('/tmp/articles');
    mocks.listen.mockResolvedValue(() => {});
  });

  afterEach(() => {
    cleanup();
  });

  it('does not mount the desktop app or Tauri side effects in a local browser preview', () => {
    mocks.isLocalWebPreviewHost.mockReturnValue(true);
    mocks.isMobile.mockReturnValue(false);

    render(<App />);

    expect(screen.getByRole('heading', { name: '网页预览已关闭' })).toBeInTheDocument();
    expect(screen.getByText('请通过 MuseAI 桌面应用使用完整功能。')).toBeInTheDocument();
    expect(screen.queryByText('桌面应用外壳')).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it('renders the desktop shell inside the Tauri host', async () => {
    mocks.isLocalWebPreviewHost.mockReturnValue(false);
    mocks.isMobile.mockReturnValue(false);

    render(<App />);

    expect(screen.getByText('桌面应用外壳')).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith('get_workspace_dir', { dirType: 'articles' });
  });

  it('keeps the LAN mobile shell available', () => {
    mocks.isLocalWebPreviewHost.mockReturnValue(false);
    mocks.isMobile.mockReturnValue(true);

    render(<App />);

    expect(screen.getByText('移动应用外壳')).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });
});
