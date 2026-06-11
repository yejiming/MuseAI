import type { PartnerItem } from '../stores/usePartnerStore';

export const UNASSIGNED_CHARACTER_CARD_GROUP_ID = '__unassigned_character_cards__';

export interface CharacterCardGroup {
  key: string;
  title: string;
  worldBookId: string | null;
  cards: PartnerItem[];
}

const hasWorldBook = (worldBooks: PartnerItem[], worldBookId?: string | null) => (
  !!worldBookId && worldBooks.some((worldBook) => worldBook.id === worldBookId)
);

export const resolveCharacterCardWorldBookId = (
  worldBooks: PartnerItem[],
  card: PartnerItem,
): string | null => (hasWorldBook(worldBooks, card.worldBookId) ? card.worldBookId! : null);

export const groupCharacterCardsByWorldBook = (
  worldBooks: PartnerItem[],
  characterCards: PartnerItem[],
): CharacterCardGroup[] => {
  const groupsByWorldBookId = new Map<string, CharacterCardGroup>();

  worldBooks.forEach((worldBook) => {
    groupsByWorldBookId.set(worldBook.id, {
      key: `world-book-${worldBook.id}`,
      title: worldBook.name,
      worldBookId: worldBook.id,
      cards: [],
    });
  });

  const unassignedGroup: CharacterCardGroup = {
    key: UNASSIGNED_CHARACTER_CARD_GROUP_ID,
    title: '未归属',
    worldBookId: null,
    cards: [],
  };

  characterCards.forEach((card) => {
    const worldBookId = resolveCharacterCardWorldBookId(worldBooks, card);
    if (!worldBookId) {
      unassignedGroup.cards.push(card);
      return;
    }
    groupsByWorldBookId.get(worldBookId)?.cards.push(card);
  });

  const groups = Array.from(groupsByWorldBookId.values()).filter((group) => group.cards.length > 0);
  if (unassignedGroup.cards.length > 0) {
    groups.push(unassignedGroup);
  }
  return groups;
};

export const getCharacterCardIdsForWorldBook = (
  worldBookId: string | null | undefined,
  characterCards: PartnerItem[],
): string[] => {
  if (!worldBookId) return [];
  return characterCards
    .filter((card) => card.worldBookId === worldBookId)
    .map((card) => card.id);
};
