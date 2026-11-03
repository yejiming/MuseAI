import { appInvoke } from './runtime';
import { BookTravelMaterial } from '../stores/useBookTravelStore';
import { usePartnerStore, compileItemToMarkdown } from '../stores/usePartnerStore';

const PROFILE_EXCERPT_LENGTH = 80;

const fileNameFromPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || path;
};

export const resolveOutlineMaterial = async (path: string): Promise<BookTravelMaterial> => {
  const content = await appInvoke('read_file', { path });
  return {
    id: path,
    title: fileNameFromPath(path),
    path,
    content,
  };
};

export const resolvePartnerMaterials = (worldBookId: string, characterCardIds: string[]) => {
  const { worldBooks, characterCards } = usePartnerStore.getState();
  const worldBook = worldBooks.find((item) => item.id === worldBookId);
  const selectedCards = characterCardIds
    .map((id) => characterCards.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    worldBook: worldBook
      ? { id: worldBook.id, title: worldBook.name, content: worldBook.content }
      : null,
    characterCards: selectedCards.map((card) => {
      let content = card.content;
      if (card.fields) {
        const cleanFields = { ...card.fields };
        delete cleanFields.relationMemory;
        delete cleanFields.userRelationType;
        delete cleanFields.userInteractionModel;
        delete cleanFields.userRelationBottomLine;
        delete cleanFields.keyEvents;

        content = compileItemToMarkdown(card.name, 'character_card', cleanFields);
      }
      return {
        id: card.id,
        title: card.name,
        content,
      };
    }),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const characterProfileMatches = (profile: string, name: string) => {
  const text = profile.trim();
  const normalizedName = name.trim();
  if (!normalizedName) return false;
  return text === normalizedName
    || text.startsWith(`${normalizedName}：`)
    || text.startsWith(`${normalizedName}:`);
};

export const characterProfileExcerpt = (content: string) => content
  .replace(/^#+\s.*$/gm, '')
  .replace(/[`*_>#-]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, PROFILE_EXCERPT_LENGTH);

export const characterProfileLine = (title: string, content: string) => {
  const excerpt = characterProfileExcerpt(content);
  return excerpt ? `${title}：${excerpt}` : title;
};

const readCharacterProfiles = (worldModel: unknown): string[] => {
  if (!isRecord(worldModel) || !Array.isArray(worldModel.selectedCharacterProfiles)) return [];
  return worldModel.selectedCharacterProfiles.filter((item): item is string => typeof item === 'string');
};

export const replaceCharacterProfiles = (
  worldModel: unknown,
  cards: Array<Pick<BookTravelMaterial, 'title' | 'content'>>,
) => {
  const base = isRecord(worldModel) ? { ...worldModel } : {};
  const profiles = [...readCharacterProfiles(base)];
  cards.forEach((card) => {
    const nextLine = characterProfileLine(card.title, card.content ?? '');
    const index = profiles.findIndex((profile) => characterProfileMatches(profile, card.title));
    if (index >= 0) {
      profiles[index] = nextLine;
      return;
    }
    profiles.push(nextLine);
  });
  return {
    ...base,
    selectedCharacterProfiles: profiles,
  };
};

export const filterSelectedCharacterProfiles = (worldModel: unknown, names: string[]) => {
  if (!isRecord(worldModel) || !Array.isArray(worldModel.selectedCharacterProfiles)) return worldModel;
  return {
    ...worldModel,
    selectedCharacterProfiles: worldModel.selectedCharacterProfiles.filter((profile) => (
      typeof profile === 'string' && names.some((name) => characterProfileMatches(profile, name))
    )),
  };
};

export const resolveEnabledCharacterCards = (
  cards: BookTravelMaterial[],
  enabledCharacterCardIds: string[] | null | undefined,
) => {
  if (!Array.isArray(enabledCharacterCardIds)) return cards;
  const enabledIds = new Set(enabledCharacterCardIds);
  return cards.filter((card) => enabledIds.has(card.id));
};

export const filterBookTravelRequestContext = (
  cards: BookTravelMaterial[],
  enabledCharacterCardIds: string[] | null | undefined,
  assembledWorldModel: unknown,
) => {
  const characterCards = resolveEnabledCharacterCards(cards, enabledCharacterCardIds);
  return {
    characterCards: characterCards.map((card) => ({
      id: card.id,
      title: card.title,
      content: card.content,
    })),
    assembledWorldModel: filterSelectedCharacterProfiles(
      assembledWorldModel,
      characterCards.map((card) => card.title),
    ),
  };
};

export const refreshAssembledCharacterCards = (
  cards: BookTravelMaterial[],
  worldBookId: string,
  characterCardIds: string[],
  worldModel: unknown,
) => {
  const { worldBooks, characterCards: libraryCards } = usePartnerStore.getState();
  const worldBookExists = worldBooks.some((item) => item.id === worldBookId);
  if (!worldBookExists) {
    return {
      characterCards: cards,
      assembledWorldModel: worldModel,
      missingIds: characterCardIds,
      refreshedCards: [] as BookTravelMaterial[],
      worldBookMissing: true,
    };
  }

  const selectedIds = new Set(characterCardIds);
  const libraryByName = new Map<string, string>();
  libraryCards.forEach((card) => {
    if (card.type !== 'character_card' || card.worldBookId !== worldBookId || libraryByName.has(card.name)) return;
    libraryByName.set(card.name, card.id);
  });

  const missingIds: string[] = [];
  const refreshedCards: BookTravelMaterial[] = [];
  const characterCards = cards.map((card) => {
    if (!selectedIds.has(card.id)) return card;
    const libraryCardId = libraryByName.get(card.title);
    const compiled = libraryCardId
      ? resolvePartnerMaterials(worldBookId, [libraryCardId]).characterCards[0]
      : undefined;
    if (!compiled) {
      missingIds.push(card.id);
      return card;
    }
    refreshedCards.push(compiled);
    return compiled;
  });
  characterCardIds.forEach((id) => {
    if (!cards.some((card) => card.id === id)) missingIds.push(id);
  });
  return {
    characterCards,
    assembledWorldModel: replaceCharacterProfiles(worldModel, refreshedCards),
    missingIds,
    refreshedCards,
    worldBookMissing: false,
  };
};
