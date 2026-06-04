import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import MobileShell from '../components/MobileShell';

describe('MobileShell', () => {
  it('uses the mobile viewport shell classes for safe-area layout', () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/" element={<MobileShell />}>
            <Route path="chat" element={<div>聊天内容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const shell = screen.getByTestId('mobile-shell');
    expect(shell).toHaveClass('mobile-shell');
    expect(shell.querySelector('.mobile-shell__header')).not.toBeNull();
    expect(shell.querySelector('.mobile-shell__content')).not.toBeNull();
    expect(shell.querySelector('.mobile-shell__nav')).not.toBeNull();
  });
});
