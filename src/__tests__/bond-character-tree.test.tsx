import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Bond from '../pages/Bond';
import { PartnerItem, usePartnerStore } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';

const invokeMock = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_agent_sessions') return [];
  return undefined;
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

const worldBook = (id: string, name: string): PartnerItem => ({
  id,
  name,
  type: 'world_book',
  content: `# ${name}`,
  fields: {},
});

const characterCard = (
  id: string,
  name: string,
  worldBookId: string | null,
  relation: string,
): PartnerItem => ({
  id,
  name,
  type: 'character_card',
  content: `# 角色卡：${name}`,
  fields: {
    identityTags: ['术士'],
    userRelationType: relation,
  },
  worldBookId,
});

describe('Bond Character Card tree', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    usePartnerStore.setState({
      worldBooks: [worldBook('wb-1', '云州世界书'), worldBook('wb-2', '北境世界书')],
      characterCards: [
        characterCard('cc-1', '沈霜', 'wb-1', '同伴'),
        characterCard('cc-2', '顾临', 'wb-2', '盟友'),
        characterCard('cc-3', '游侠', null, '过客'),
      ],
      selectedId: null,
      selectedType: null,
    });
    usePartnerChatStore.setState({
      selectedCharacterCardId: null,
    });
  });

  it('shows characters grouped by World Book and selects cards from the tree', async () => {
    render(<Bond />);

    const tree = document.querySelector('.bond-character-tree') as HTMLElement;

    await waitFor(() => {
      expect(within(tree).getByText('云州世界书')).toBeInTheDocument();
    });
    expect(within(tree).getByText('沈霜')).toBeInTheDocument();
    expect(within(tree).getByText('北境世界书')).toBeInTheDocument();
    expect(within(tree).queryByText('顾临')).not.toBeInTheDocument();
    expect(within(tree).getByText('未归属')).toBeInTheDocument();

    fireEvent.click(within(tree).getByText('北境世界书'));
    fireEvent.click(within(tree).getByText('顾临'));

    expect(usePartnerChatStore.getState().selectedCharacterCardId).toBe('cc-2');
    expect(screen.getByText('盟友')).toBeInTheDocument();

    fireEvent.click(within(tree).getByText('北境世界书'));

    await waitFor(() => {
      expect(within(tree).getByText('顾临')).not.toBeVisible();
    });
    expect(usePartnerChatStore.getState().selectedCharacterCardId).toBe('cc-2');
    expect(screen.getByText('盟友')).toBeInTheDocument();
  });
});
