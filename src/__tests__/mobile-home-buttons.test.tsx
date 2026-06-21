import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileHome from '../pages/MobileHome';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useStoryStore } from '../stores/useStoryStore';

const runtimeMocks = vi.hoisted(() => ({
  appInvoke: vi.fn(),
  clearMobileToken: vi.fn(),
  getMobileToken: vi.fn(),
  setMobileToken: vi.fn(),
}));

vi.mock('../utils/runtime', () => runtimeMocks);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

describe('MobileHome navigation buttons', () => {
  beforeEach(() => {
    runtimeMocks.appInvoke.mockReset();
    runtimeMocks.clearMobileToken.mockReset();
    runtimeMocks.getMobileToken.mockReset();
    runtimeMocks.setMobileToken.mockReset();
    vi.spyOn(usePartnerStore.persist, 'rehydrate').mockResolvedValue();
    vi.spyOn(usePartnerChatStore.persist, 'rehydrate').mockResolvedValue();
    vi.spyOn(useStoryStore.persist, 'rehydrate').mockResolvedValue();
  });

  it('shows token input and disables feature entries when no token is available', () => {
    runtimeMocks.getMobileToken.mockReturnValue('');

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MobileHome />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('连接状态：等待验证')).toBeInTheDocument();
    expect(screen.getByLabelText('访问令牌')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '验证并连接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /伴侣聊天/ })).toBeDisabled();
    expect(screen.queryByText('连接状态：已连接')).not.toBeInTheDocument();
  });

  it('validates and saves a token before enabling feature entries', async () => {
    runtimeMocks.getMobileToken.mockReturnValue('');
    runtimeMocks.appInvoke.mockImplementation((_command, args) => Promise.resolve(
      args?.sessionKind === 'story'
        ? [{ id: 'story-session-1', title: '故事记录', savedAt: 2, sessionKind: 'story' }]
        : [{ id: 'partner-session-1', title: '聊天记录', savedAt: 1 }],
    ));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MobileHome />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('访问令牌'), {
      target: { value: 'valid-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: '验证并连接' }));

    expect(screen.getByText('连接状态：正在验证…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('连接状态：已验证')).toBeInTheDocument();
    });
    expect(runtimeMocks.setMobileToken).toHaveBeenCalledWith('valid-token');
    expect(runtimeMocks.appInvoke).toHaveBeenCalledWith('list_agent_sessions', {
      prefix: 'partner-session-',
    });
    expect(runtimeMocks.appInvoke).toHaveBeenCalledWith('list_agent_sessions', {
      prefix: 'story-session-',
      sessionKind: 'story',
    });
    expect(usePartnerStore.persist.rehydrate).toHaveBeenCalled();
    expect(usePartnerChatStore.persist.rehydrate).toHaveBeenCalled();
    expect(useStoryStore.persist.rehydrate).toHaveBeenCalled();
    expect(usePartnerChatStore.getState().sessions).toEqual([
      { id: 'partner-session-1', title: '聊天记录', savedAt: 1 },
    ]);
    expect(useStoryStore.getState().sessions).toEqual([
      { id: 'story-session-1', title: '故事记录', savedAt: 2, sessionKind: 'story' },
    ]);
    expect(screen.getByRole('button', { name: /伴侣聊天/ })).toBeEnabled();
  });

  it('rejects an invalid token and keeps feature entries disabled', async () => {
    runtimeMocks.getMobileToken.mockReturnValue('');
    runtimeMocks.appInvoke.mockRejectedValue(new Error('HTTP error 401'));

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MobileHome />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('访问令牌'), {
      target: { value: 'invalid-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: '验证并连接' }));

    await waitFor(() => {
      expect(screen.getByText('访问令牌无效，请检查后重试')).toBeInTheDocument();
    });
    expect(runtimeMocks.clearMobileToken).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /伴侣聊天/ })).toBeDisabled();
  });

  it('automatically validates an existing token and preserves navigation', async () => {
    runtimeMocks.getMobileToken.mockReturnValue('saved-token');
    runtimeMocks.appInvoke.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={(
              <>
                <MobileHome />
                <LocationProbe />
              </>
            )}
          />
          <Route path="/chat" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('连接状态：已验证')).toBeInTheDocument();
    });
    expect(runtimeMocks.setMobileToken).toHaveBeenCalledWith('saved-token');

    const chatEntry = screen.getByRole('button', { name: /伴侣聊天/ });
    expect(chatEntry.tagName).toBe('BUTTON');
    expect(chatEntry).toHaveAttribute('type', 'button');

    chatEntry.focus();
    expect(chatEntry).toHaveFocus();

    fireEvent.click(chatEntry);
    expect(screen.getByTestId('current-path')).toHaveTextContent('/chat');
  });
});
