import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AppShell from '../components/AppShell';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('AppShell book-travel desktop menu', () => {
  it('places adventure below chat and book-travel pages below bond with a divider', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/bond']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="bond" element={<div>羁绊内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('聊天')).toBeInTheDocument();
    expect(screen.getByText('冒险')).toBeInTheDocument();
    expect(screen.getByText('羁绊')).toBeInTheDocument();
    expect(screen.getByText('素材')).toBeInTheDocument();
    expect(screen.getByText('穿书')).toBeInTheDocument();

    const menuItems = Array.from(container.querySelectorAll('.ant-menu-item, .ant-menu-item-divider'))
      .map((item) => item.textContent?.trim() || 'DIVIDER');
    const chatIndex = menuItems.indexOf('聊天');
    const adventureIndex = menuItems.indexOf('冒险');
    const bondIndex = menuItems.indexOf('羁绊');
    const materialIndex = menuItems.indexOf('素材');
    const storyIndex = menuItems.indexOf('穿书');

    expect(chatIndex).toBeGreaterThan(-1);
    expect(adventureIndex).toBe(chatIndex + 1);
    expect(bondIndex).toBeGreaterThan(-1);
    expect(bondIndex).toBe(adventureIndex + 1);
    expect(materialIndex).toBeGreaterThan(bondIndex);
    expect(storyIndex).toBeGreaterThan(materialIndex);
    expect(menuItems[bondIndex + 1]).toBe('DIVIDER');
  });

  it('uses a distinct icon for the book-travel page menu item', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/story']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="story" element={<div>穿书内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const storyItem = Array.from(container.querySelectorAll('.ant-menu-item'))
      .find((item) => item.textContent?.trim() === '穿书') as HTMLElement;

    expect(storyItem.querySelector('.anticon-deployment-unit')).toBeInTheDocument();
    expect(storyItem.querySelector('.anticon-compass')).not.toBeInTheDocument();
  });
});
