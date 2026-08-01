import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import Settings from '../pages/Settings';
import { defaultAgentConfigs, useSettingsStore } from '../stores/useSettingsStore';

const switchLabel = '令牌固定不变';

function mockStatus(fixedTokenEnabled: boolean) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === 'get_mobile_service_status') {
      return Promise.resolve({
        isRunning: true,
        url: `http://192.168.1.2:4080/?token=${fixedTokenEnabled ? 'fixed-token' : 'random-token'}`,
        token: fixedTokenEnabled ? 'fixed-token' : 'random-token',
        fixedTokenEnabled,
        error: null,
      });
    }
    return Promise.resolve();
  });
}

describe('Settings 局域网固定令牌', () => {
  beforeEach(() => {
    act(() => {
      useSettingsStore.setState({
        agentConfigs: defaultAgentConfigs,
      });
    });
    vi.mocked(invoke).mockReset();
  });

  it('renders the fixed token switch unchecked by default', async () => {
    mockStatus(false);
    render(<Settings />);

    const switchEl = await screen.findByRole('switch', { name: switchLabel });
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the switch checked when a fixed token is already persisted', async () => {
    mockStatus(true);
    render(<Settings />);

    const switchEl = await screen.findByRole('switch', { name: switchLabel });
    await waitFor(() => {
      expect(switchEl).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('toggles the fixed token on and keeps the switch checked after refresh', async () => {
    let fixedEnabled = false;
    vi.mocked(invoke).mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'set_mobile_fixed_token') {
        fixedEnabled = Boolean(args?.enabled);
        return Promise.resolve('fixed-token');
      }
      if (cmd === 'get_mobile_service_status') {
        return Promise.resolve({
          isRunning: true,
          url: `http://192.168.1.2:4080/?token=${fixedEnabled ? 'fixed-token' : 'random-token'}`,
          token: fixedEnabled ? 'fixed-token' : 'random-token',
          fixedTokenEnabled: fixedEnabled,
          error: null,
        });
      }
      return Promise.resolve();
    });
    render(<Settings />);

    const switchEl = await screen.findByRole('switch', { name: switchLabel });
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(switchEl);

    await waitFor(() => {
      expect(switchEl).toHaveAttribute('aria-checked', 'true');
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_mobile_fixed_token', { enabled: true });
    });
  });

  it('turns off the fixed token and keeps the switch unchecked after refresh', async () => {
    let fixedEnabled = true;
    vi.mocked(invoke).mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'set_mobile_fixed_token') {
        fixedEnabled = Boolean(args?.enabled);
        return Promise.resolve('new-random-token');
      }
      if (cmd === 'get_mobile_service_status') {
        return Promise.resolve({
          isRunning: true,
          url: `http://192.168.1.2:4080/?token=${fixedEnabled ? 'fixed-token' : 'new-random-token'}`,
          token: fixedEnabled ? 'fixed-token' : 'new-random-token',
          fixedTokenEnabled: fixedEnabled,
          error: null,
        });
      }
      return Promise.resolve();
    });
    render(<Settings />);

    const switchEl = await screen.findByRole('switch', { name: switchLabel });
    await waitFor(() => {
      expect(switchEl).toHaveAttribute('aria-checked', 'true');
    });
    fireEvent.click(switchEl);

    await waitFor(() => {
      expect(switchEl).toHaveAttribute('aria-checked', 'false');
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('set_mobile_fixed_token', { enabled: false });
    });
  });
});
