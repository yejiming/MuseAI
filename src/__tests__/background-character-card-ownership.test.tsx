import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Background from '../pages/Background';
import { PartnerItem, usePartnerStore } from '../stores/usePartnerStore';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

const worldBook = (id: string, name: string): PartnerItem => ({
  id,
  name,
  type: 'world_book',
  content: `# ${name}`,
  fields: {},
});

const characterCard = (id: string, name: string, worldBookId?: string | null): PartnerItem => ({
  id,
  name,
  type: 'character_card',
  content: `# 角色卡：${name}`,
  fields: { age: '18岁' },
  worldBookId,
});

describe('Background Character Card ownership', () => {
  beforeEach(() => {
    usePartnerStore.setState({
      worldBooks: [worldBook('wb-1', '云州世界书'), worldBook('wb-2', '北境世界书')],
      characterCards: [
        characterCard('cc-1', '沈霜', 'wb-1'),
        characterCard('cc-2', '顾临'),
      ],
      selectedId: null,
      selectedType: null,
    });
  });

  it('renders Character Cards grouped by World Book and unassigned folder', () => {
    render(<Background />);

    expect(screen.getAllByText('云州世界书').length).toBeGreaterThan(0);
    expect(screen.getByText('沈霜')).toBeInTheDocument();
    expect(screen.getByText('未归属')).toBeInTheDocument();
    expect(screen.getByText('顾临')).toBeInTheDocument();
  });

  it('toggles Character Card folders by clicking the folder title without changing selection', async () => {
    render(<Background />);

    fireEvent.click(screen.getByText('沈霜'));
    expect(usePartnerStore.getState().selectedId).toBe('cc-1');

    const tree = document.querySelector('.character-card-tree') as HTMLElement;
    const groupTitle = within(tree).getByText('云州世界书');

    fireEvent.click(groupTitle);

    await waitFor(() => {
      expect(within(tree).getByText('沈霜')).not.toBeVisible();
    });
    expect(usePartnerStore.getState().selectedId).toBe('cc-1');

    fireEvent.click(groupTitle);

    await waitFor(() => {
      expect(within(tree).getByText('沈霜')).toBeVisible();
    });
    expect(usePartnerStore.getState().selectedId).toBe('cc-1');
  });

  it('edits Character Card World Book ownership from the detail panel', async () => {
    render(<Background />);

    fireEvent.click(screen.getByText('沈霜'));
    expect(await screen.findByDisplayValue('沈霜')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('归属世界书'));
    const northOptions = await screen.findAllByText('北境世界书');
    fireEvent.click(northOptions[northOptions.length - 1]);

    await waitFor(() => {
      expect(usePartnerStore.getState().characterCards.find((card) => card.id === 'cc-1')?.worldBookId).toBe('wb-2');
    });

    fireEvent.mouseDown(screen.getByLabelText('归属世界书'));
    const unassignedOptions = await screen.findAllByText('未归属');
    fireEvent.click(unassignedOptions[unassignedOptions.length - 1]);

    await waitFor(() => {
      expect(usePartnerStore.getState().characterCards.find((card) => card.id === 'cc-1')?.worldBookId).toBeNull();
    });
  });
});
