import { beforeEach, describe, expect, it } from 'vitest';
import { usePartnerStore, PartnerItem } from '../stores/usePartnerStore';
import {
  getCharacterCardIdsForWorldBook,
  groupCharacterCardsByWorldBook,
} from '../utils/characterCardGroups';

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
  fields: {},
  worldBookId,
});

describe('partner store character card ownership', () => {
  beforeEach(() => {
    usePartnerStore.setState({
      worldBooks: [worldBook('wb-1', '云州世界书'), worldBook('wb-2', '北境世界书')],
      characterCards: [characterCard('cc-1', '沈霜')],
      selectedId: null,
      selectedType: null,
    });
  });

  it('assigns and clears Character Card World Book ownership without changing content', () => {
    const originalContent = usePartnerStore.getState().characterCards[0].content;

    usePartnerStore.getState().updateCharacterCardWorldBook('cc-1', 'wb-1');
    expect(usePartnerStore.getState().characterCards[0].worldBookId).toBe('wb-1');
    expect(usePartnerStore.getState().characterCards[0].content).toBe(originalContent);

    usePartnerStore.getState().updateCharacterCardWorldBook('cc-1', null);
    expect(usePartnerStore.getState().characterCards[0].worldBookId).toBeNull();
    expect(usePartnerStore.getState().characterCards[0].content).toBe(originalContent);
  });

  it('clears Character Card ownership when deleting the owning World Book', () => {
    usePartnerStore.setState({
      characterCards: [
        characterCard('cc-1', '沈霜', 'wb-1'),
        characterCard('cc-2', '顾临', 'wb-2'),
        characterCard('cc-3', '无归属角色', null),
      ],
    });

    usePartnerStore.getState().deleteItem('wb-1', 'world_book');

    expect(usePartnerStore.getState().characterCards).toEqual([
      expect.objectContaining({ id: 'cc-1', worldBookId: null }),
      expect.objectContaining({ id: 'cc-2', worldBookId: 'wb-2' }),
      expect.objectContaining({ id: 'cc-3', worldBookId: null }),
    ]);
  });

  it('keeps selected Character Card visible when deleting its owning World Book', () => {
    usePartnerStore.setState({
      characterCards: [
        characterCard('cc-1', '沈霜', 'wb-1'),
        characterCard('cc-2', '顾临', 'wb-2'),
      ],
      selectedId: 'cc-1',
      selectedType: 'character_card',
    });

    usePartnerStore.getState().deleteItem('wb-1', 'world_book');

    expect(usePartnerStore.getState().characterCards).toEqual([
      expect.objectContaining({ id: 'cc-1', worldBookId: null }),
      expect.objectContaining({ id: 'cc-2', worldBookId: 'wb-2' }),
    ]);
    expect(usePartnerStore.getState().selectedId).toBe('cc-1');
    expect(usePartnerStore.getState().selectedType).toBe('character_card');
  });

  it('groups cards by valid World Book owner and keeps missing or invalid owners unassigned', () => {
    const groups = groupCharacterCardsByWorldBook(
      [worldBook('wb-1', '云州世界书'), worldBook('wb-2', '北境世界书')],
      [
        characterCard('cc-1', '沈霜', 'wb-1'),
        characterCard('cc-2', '顾临'),
        characterCard('cc-3', '旧卡', 'deleted-world'),
      ],
    );

    expect(groups.map((group) => ({
      title: group.title,
      cardIds: group.cards.map((card) => card.id),
    }))).toEqual([
      { title: '云州世界书', cardIds: ['cc-1'] },
      { title: '未归属', cardIds: ['cc-2', 'cc-3'] },
    ]);
  });

  it('returns owned card IDs for automatic material selection', () => {
    const cards = [
      characterCard('cc-1', '沈霜', 'wb-1'),
      characterCard('cc-2', '顾临', 'wb-1'),
      characterCard('cc-3', '旧卡', 'deleted-world'),
    ];

    expect(getCharacterCardIdsForWorldBook('wb-1', cards)).toEqual(['cc-1', 'cc-2']);
    expect(getCharacterCardIdsForWorldBook('wb-2', cards)).toEqual([]);
  });

  it('preserves generated Character Card ownership when provided', () => {
    usePartnerStore.getState().importGeneratedItems({
      worldBooks: [],
      characterCards: [
        { name: '林晚', fields: { age: '18岁' }, worldBookId: 'wb-1' },
        { name: '无归属角色', fields: { age: '20岁' } },
      ],
    });

    expect(usePartnerStore.getState().characterCards.slice(-2)).toEqual([
      expect.objectContaining({ name: '林晚', worldBookId: 'wb-1' }),
      expect.objectContaining({ name: '无归属角色', worldBookId: null }),
    ]);
  });
});
